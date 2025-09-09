async function regenLink() {
	const resp = await fetch('/dashboard/widget/regenerate', { method: 'POST' });
	const data = await resp.json();
	document.getElementById('widgetLink').value = data.widgetUrl;
}

async function saveOptions() {
	const title = document.getElementById('title').value;
	const durationSec = document.getElementById('duration').value;
	const options = Array.from(document.querySelectorAll('.opt-input')).map(i => i.value).filter(Boolean);
	const resp = await fetch('/dashboard/options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, durationSec, options }) });
	const data = await resp.json();
	if (data.pollId) {
		window.currentPollId = data.pollId;
		alert('Список сохранён');
	} else {
		alert('Ошибка: ' + (data.error || 'unknown'));
	}
}

async function createPoll() {
	if (!window.currentPollId) { alert('Сначала сохраните список вариантов'); return; }
	const resp = await fetch('/dashboard/polls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pollId: window.currentPollId }) });
	const data = await resp.json();
	if (data.ok) alert('Опрос создан на Twitch'); else alert('Ошибка: ' + (data.details || data.error));
}

function addOption() {
	const container = document.getElementById('options');
	const input = document.createElement('input');
	input.className = 'opt-input';
	input.placeholder = 'Вариант';
	container.appendChild(input);
}


