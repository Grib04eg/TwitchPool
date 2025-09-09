/* global Chart, io */
(() => {
	const token = document.currentScript.getAttribute('data-token');
	const socket = io();
	socket.emit('join', token);
	const ctx = document.getElementById('canvas').getContext('2d');
	const chart = new Chart(ctx, {
		type: 'pie',
		data: { labels: [], datasets: [{ data: [], backgroundColor: [] }] },
		options: { plugins: { legend: { labels: { color: '#fff' } } } }
	});
	function randomColor() { return `hsl(${Math.floor(Math.random()*360)}, 70%, 55%)`; }
	socket.on('poll:update', (poll) => {
		const labels = poll.choices.map(c => c.title);
		const counts = poll.choices.map(c => c.votes);
		const colors = labels.map((_, i) => chart.data.datasets[0].backgroundColor[i] || randomColor());
		chart.data.labels = labels;
		chart.data.datasets[0].data = counts;
		chart.data.datasets[0].backgroundColor = colors;
		chart.update();
	});
})();


