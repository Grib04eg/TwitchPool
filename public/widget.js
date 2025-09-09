/* global Chart, io */
(() => {
	const token = document.currentScript.getAttribute('data-token');
	const socket = io();
	socket.emit('join', token);
	const canvasEl = document.getElementById('canvas');
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
			const colors = labels.map((_, i) => chart.data.datasets[0].backgroundColor[i] || randomColor());
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
			// показать ещё 10 секунд, затем скрыть
			hideTimer = setTimeout(() => {
				if (canvasEl) canvasEl.style.display = 'none';
				if (winnerOverlay) winnerOverlay.style.display = 'none';
			}, 10000);
			wasActive = false;
		} else {
			// был не активен при заходе — ничего не показываем
			if (canvasEl) canvasEl.style.display = 'none';
			if (winnerOverlay) winnerOverlay.style.display = 'none';
			chart.data.labels = [];
			chart.data.datasets[0].data = [];
			chart.update();
		}
	});
})();


