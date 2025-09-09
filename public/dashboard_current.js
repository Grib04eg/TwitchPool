async function fetchCurrent() {
	try {
		const r = await fetch('/api/current-poll');
		const j = await r.json();
		const poll = j.poll;
		const curTitle = document.getElementById('curTitle');
		const curStatus = document.getElementById('curStatus');
		const curSummary = document.getElementById('curSummary');
		if (!poll) {
			curStatus.textContent = 'Статус: —';
			curSummary.textContent = '—';
			return;
		}
		if (curTitle) curTitle.textContent = poll.title || curTitle.textContent;
		if (curStatus) curStatus.textContent = 'Статус: ' + (poll.status || 'unknown');
		if (curSummary) {
			const parts = (poll.choices || []).map(c => `${c.title}: ${c.votes}`);
			curSummary.textContent = parts.join(' • ');
		}
	} catch (_) {}
}

async function endNow() {
	try {
		const r = await fetch('/api/end-poll', { method: 'POST' });
		if (!r.ok) {
			alert('Не удалось завершить опрос');
			return;
		}
		await fetchCurrent();
		alert('Опрос завершён');
	} catch (_) { alert('Ошибка при завершении опроса'); }
}

document.addEventListener('DOMContentLoaded', () => {
	const btn = document.getElementById('btnEndPoll');
	if (btn) btn.addEventListener('click', endNow);
	fetchCurrent();
	setInterval(fetchCurrent, 5000);
});


