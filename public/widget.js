/* global Chart, io */
(() => {
	const token = document.currentScript.getAttribute('data-token');
	const socket = io();
	socket.emit('join', token);
	const canvasEl = document.getElementById('canvas');
	const shadeEl = document.getElementById('shade');
	// Изначально скрыт, пока не получим активный опрос
	if (canvasEl) canvasEl.style.display = 'none';
	const ctx = canvasEl.getContext('2d');
	const winnerOverlay = document.getElementById('winnerOverlay');
	const winnerText = document.getElementById('winnerText');

	function resizeCanvas() {
		const parent = canvasEl.parentElement || document.body;
		const w = parent.clientWidth || window.innerWidth;
		const h = parent.clientHeight || window.innerHeight;
		canvasEl.width = w; // controls render resolution
		canvasEl.height = h;
		if (shadeEl) { shadeEl.width = w; shadeEl.height = h; shadeEl.style.width = '100%'; shadeEl.style.height = '100%'; shadeEl.style.position = 'absolute'; shadeEl.style.left = 0; shadeEl.style.top = 0; }
		chart && chart.resize();
	}
	const chart = new Chart(ctx, {
		type: 'pie',
		data: { labels: [], datasets: [{ data: [], backgroundColor: [] }] },
		options: {
			plugins: { legend: { display: false } },
			maintainAspectRatio: false,
		}
	});

	resizeCanvas();
	window.addEventListener('resize', resizeCanvas);
	function randomColor() { return `hsl(${Math.floor(Math.random()*360)}, 70%, 55%)`; }
	let hideTimer = null;
	let wasActive = false;
	let lastPollId = null;

	function drawCenterLabels(chartInstance) {
		const { ctx } = chartInstance;
		const meta = chartInstance.getDatasetMeta(0);
		ctx.save();
		ctx.fillStyle = '#fff';
		// адаптивный размер шрифта относительно меньшей стороны
		const minSide = Math.min(chartInstance.width, chartInstance.height);
		const base = Math.max(16, Math.round(minSide * 0.10)); // 10% от меньшей стороны
		ctx.font = `bold ${base}px Inter, Arial, sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.lineWidth = 4;
		ctx.strokeStyle = 'rgba(0,0,0,0.85)';
		meta.data.forEach((arc, idx) => {
			const value = chartInstance.data.datasets[0].data[idx] || 0;
			if (!value) return; // показывать подпись только если есть голоса
			const label = chartInstance.data.labels[idx];
			const pos = arc.getProps(['x','y','startAngle','endAngle','outerRadius','innerRadius'], true);
			const angle = (pos.startAngle + pos.endAngle) / 2;
			const r = (pos.innerRadius + pos.outerRadius) / 2;
			const x = pos.x + Math.cos(angle) * r;
			const y = pos.y + Math.sin(angle) * r;
			ctx.strokeText(label, x, y);
			ctx.fillText(label, x, y);
		});
		ctx.restore();
	}

	Chart.register({
		id: 'centerLabelsPlugin',
		afterDraw: (c) => drawCenterLabels(c)
	});

	socket.on('poll:update', (poll) => {
		if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
		const status = (poll.status || '').toLowerCase();
		const isActive = status === 'active';
		const isEnded = status === 'terminated' || status === 'completed' || status === 'ended' || status === 'archived';

		if (isActive) {
			const labels = poll.choices.map(c => c.title);
			const counts = poll.choices.map(c => c.votes);
			let colors = chart.data.datasets[0].backgroundColor || [];
			if (poll.id && poll.id !== lastPollId) {
				// новый опрос — сгенерировать новую палитру
				colors = labels.map(() => randomColor());
				lastPollId = poll.id;
			} else {
				// тот же опрос — дополнить недостающие цвета
				colors = labels.map((_, i) => colors[i] || randomColor());
			}
			chart.data.labels = labels;
			chart.data.datasets[0].data = counts;
			chart.data.datasets[0].backgroundColor = colors;
			chart.update();
			if (canvasEl) canvasEl.style.display = '';
			if (winnerOverlay) winnerOverlay.style.display = 'none';
			wasActive = true;
			return;
		}

		// not active
		if (wasActive && isEnded) {
			// Подсчёт победителей
			const counts = poll.choices.map(c => c.votes || 0);
			const max = Math.max(...counts);
			const winners = poll.choices.filter(c => (c.votes || 0) === max && max > 0).map(c => c.title);
			if (winnerText) {
				const prefix = winners.length > 1 ? 'Победители' : 'Победитель';
				const names = winners.length > 0 ? winners.join(' • ') : 'Нет голосов';
				winnerText.innerHTML = `${prefix}:<br>${names}`;
			}
			if (winnerOverlay) {
				winnerOverlay.style.display = 'flex';
				winnerText && (winnerText.style.animation = 'none', winnerText.offsetHeight, winnerText.style.animation = 'popIn .6s ease both');
			}
			// затемнить только область кольца
			if (shadeEl) {
				const sctx = shadeEl.getContext('2d');
				sctx.clearRect(0,0,shadeEl.width,shadeEl.height);
				sctx.fillStyle = 'rgba(0,0,0,0.55)';
				sctx.fillRect(0,0,shadeEl.width,shadeEl.height);
				// вырезать круг по радиусу диаграммы
				const meta = chart.getDatasetMeta(0);
				if (meta && meta.data && meta.data[0]) {
					const a0 = meta.data[0];
					const p = a0.getProps(['x','y','outerRadius','innerRadius'], true);
					sctx.globalCompositeOperation = 'destination-out';
					sctx.beginPath();
					sctx.arc(p.x, p.y, p.outerRadius, 0, Math.PI*2);
					sctx.arc(p.x, p.y, Math.max(p.innerRadius, 0), 0, Math.PI*2, true);
					sctx.fill();
					sctx.globalCompositeOperation = 'source-over';
				}
				shadeEl.style.display = 'block';
			}

			// показать ещё 10 секунд, затем скрыть
			hideTimer = setTimeout(() => {
				if (canvasEl) canvasEl.style.display = 'none';
				if (winnerOverlay) winnerOverlay.style.display = 'none';
				if (shadeEl) shadeEl.style.display = 'none';
			}, 10000);
			wasActive = false;
		} else {
			// был не активен при заходе — ничего не показываем
			if (canvasEl) canvasEl.style.display = 'none';
			if (winnerOverlay) winnerOverlay.style.display = 'none';
			if (shadeEl) shadeEl.style.display = 'none';
			chart.data.labels = [];
			chart.data.datasets[0].data = [];
			chart.update();
		}
	});
})();


