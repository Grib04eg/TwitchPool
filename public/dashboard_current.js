async function fetchCurrent() {
	try {
		const r = await fetch('/api/current-poll');
		const j = await r.json();
		const poll = j.poll;
		const curTitle = document.getElementById('curTitle');
		const curStatus = document.getElementById('curStatus');
		const curSummary = document.getElementById('curSummary');
		const btnEndPoll = document.getElementById('btnEndPoll');
		if (!poll) {
			curStatus.textContent = 'Статус: —';
			curSummary.textContent = '—';
			if (btnEndPoll) btnEndPoll.style.display = 'none';
			return;
		}
		if (curTitle) curTitle.textContent = poll.title || curTitle.textContent;
		if (curStatus) curStatus.textContent = 'Статус: ' + (poll.status || 'unknown');
		if (curSummary) {
			const choices = poll.choices || [];
			if (choices.length > 0) {
				// Найти максимальное количество голосов
				const maxVotes = Math.max(...choices.map(c => c.votes || 0));
				// Создать HTML с выделением жирным для побеждающих вариантов
				const parts = choices.map(c => {
					const isWinner = (c.votes || 0) === maxVotes && maxVotes > 0;
					return isWinner ? `<strong>${c.title}: ${c.votes}</strong>` : `${c.title}: ${c.votes}`;
				});
				curSummary.innerHTML = parts.join(' • ');
			} else {
				curSummary.textContent = '—';
			}
		}
		// Скрыть кнопку завершить если опрос не активен
		if (btnEndPoll) {
			btnEndPoll.style.display = (poll.status === 'active') ? 'inline-block' : 'none';
		}
	} catch (_) {}
}

async function endNow() {
	try {
		const r = await fetch('/api/end-poll', { method: 'POST' });
		if (!r.ok) {
			if (typeof toast === 'function') toast('Не удалось завершить опрос', 'error', 3500);
			return;
		}
		await fetchCurrent();
		if (typeof toast === 'function') toast('Опрос завершён');
	} catch (_) { if (typeof toast === 'function') toast('Ошибка при завершении опроса', 'error', 3500); }
}

function ensureToastContainer() {
	if (!document.getElementById('toasts')) {
		const box = document.createElement('div');
		box.id = 'toasts';
		box.className = 'toasts';
		document.body.appendChild(box);
	}
}

document.addEventListener('DOMContentLoaded', () => {
	ensureToastContainer();
	const btn = document.getElementById('btnEndPoll');
	if (btn) btn.addEventListener('click', endNow);
	fetchCurrent();
	setInterval(fetchCurrent, 5000);
});


