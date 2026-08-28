const select = selector => document.querySelector(selector);
let shopToken = '';

function documentInside(token) {
  const encoded = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(encoded + '='.repeat((4 - encoded.length % 4) % 4)));
}

async function asJson(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'The Token Shop could not process that request.');
  return body;
}

select('#claim').addEventListener('click', async () => {
  const status = select('#status');
  status.textContent = 'Claiming…';
  try {
    const result = await fetch('/api/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: select('#username').value })
    }).then(asJson);
    shopToken = result.bundle.find(token => documentInside(token).role === 'customer');
    select('#token').textContent = shopToken;
    select('#bundle').textContent = `${result.bundle.length} signed tokens are attached to this response.`;
    select('#token-panel').hidden = false;
    status.textContent = result.message;
  } catch (error) {
    status.textContent = error.message;
  }
});

select('#copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(shopToken);
  select('#copy').textContent = 'Copied';
});

select('#visit').addEventListener('click', async () => {
  const status = select('#shop-status');
  status.textContent = 'Checking token…';
  try {
    const result = await fetch('/api/shop', {
      headers: { 'X-Shop-Token': shopToken }
    }).then(asJson);
    status.textContent = result.flag ? result.flag : result.message;
  } catch (error) {
    status.textContent = error.message;
  }
});
