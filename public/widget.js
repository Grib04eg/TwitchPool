/* global Chart, io */
(() => {
	const token = document.currentScript.getAttribute('data-token');
	const socket = io();
	socket.emit('join', token);
	const ctx = document.getElementById('canvas').getContext('2d');
	const chart = new Chart(ctx, {
		type: 'pie',
		data: { labels: [], datasets: [{ data: [], backgroundColor: [] }] },
		options: {
			plugins: { legend: { display: false } },
		}
	});
	function randomColor() { return `hsl(${Math.floor(Math.random()*360)}, 70%, 55%)`; }
	let hideTimer = null;

	function drawCenterLabels(chartInstance) {
		const { ctx } = chartInstance;
		const meta = chartInstance.getDatasetMeta(0);
		ctx.save();
		ctx.fillStyle = '#fff';
		ctx.font = '12px Inter, Arial';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		meta.data.forEach((arc, idx) => {
			const value = chartInstance.data.datasets[0].data[idx] || 0;
			if (!value) return; // показывать подпись только если есть голоса
			const label = chartInstance.data.labels[idx];
			const pos = arc.getProps(['x','y','startAngle','endAngle','outerRadius','innerRadius'], true);
			const angle = (pos.startAngle + pos.endAngle) / 2;
			const r = (pos.innerRadius + pos.outerRadius) / 2;
			const x = pos.x + Math.cos(angle) * r;
			const y = pos.y + Math.sin(angle) * r;
			ctx.fillText(label, x, y);
		});
		ctx.restore();
	}

	Chart.register({
		id: 'centerLabelsPlugin',
		afterDraw: (c) => drawCenterLabels(c)
	});

	socket.on('poll:update', (poll) => {
		const labels = poll.choices.map(c => c.title);
		const counts = poll.choices.map(c => c.votes);
		const colors = labels.map((_, i) => chart.data.datasets[0].backgroundColor[i] || randomColor());
		chart.data.labels = labels;
		chart.data.datasets[0].data = counts;
		chart.data.datasets[0].backgroundColor = colors;
		chart.update();

		if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
		const status = (poll.status || '').toLowerCase();
		if (status === 'terminated' || status === 'completed' || status === 'ended') {
			hideTimer = setTimeout(() => {
				chart.data.labels = [];
				chart.data.datasets[0].data = [];
				chart.update();
			}, 10000);
		}
	});
})();


