// Run only in Docker. This development tool is never imported by the application.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const tokenFile = await fs.readFile('/workspace/token.txt', 'utf8');
const token = tokenFile.match(/r8_[A-Za-z0-9]+/)?.[0];
if (!token) throw new Error('No Replicate token found in the local credential file.');
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const model = 'google/nano-banana-pro';
const api = async (url, options = {}) => {
  const response = await fetch(url, { headers, ...options });
  if (!response.ok)
    throw new Error(`Replicate request failed (${response.status}); no automatic retry.`);
  return response.json();
};
if (process.argv[2] === 'schema') {
  const value = await api(`https://api.replicate.com/v1/models/${model}`);
  console.log(JSON.stringify(value.latest_version?.openapi_schema?.components?.schemas, null, 2));
} else if (process.argv[2] === 'inspect-failure') {
  const receipt = JSON.parse(
    await fs.readFile('assets/receipts/imagen-oaxaca-tree-failed.json', 'utf8'),
  );
  const job = await api(`https://api.replicate.com/v1/predictions/${receipt.id}`);
  console.log(JSON.stringify({ state: job.status, error: job.error, metrics: job.metrics }));
} else if (process.argv[2] === 'generate-approved-batch') {
  const requests = JSON.parse(await fs.readFile('assets/requests/landscape.json', 'utf8'));
  if (requests.length !== 3)
    throw new Error('This approved batch is limited to three images, estimated $0.45.');
  await fs.mkdir('public/assets', { recursive: true });
  await fs.mkdir('assets/sources', { recursive: true });
  for (const request of requests) {
    const receiptPath = `assets/receipts/${request.name}.json`;
    let receipt;
    try {
      receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (receipt?.state === 'succeeded') {
      console.log(`${request.name}: already saved`);
      continue;
    }
    if (receipt?.state === 'submitting')
      throw new Error(
        'Submission outcome uncertain; inspect provider before another charged request.',
      );
    if (!receipt) {
      await fs.writeFile(
        receiptPath,
        JSON.stringify({ model, state: 'submitting', estimatedUsd: 0.15 }),
      );
      const job = await api(`https://api.replicate.com/v1/models/${model}/predictions`, {
        method: 'POST',
        body: JSON.stringify({ input: request.input }),
      });
      receipt = {
        model,
        id: job.id,
        state: job.status,
        estimatedUsd: 0.15,
        createdAt: job.created_at,
      };
      await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2));
    }
    let job;
    do {
      job = await api(`https://api.replicate.com/v1/predictions/${receipt.id}`);
      console.log(`${request.name}: ${job.status}`);
      if (!['succeeded', 'failed', 'canceled'].includes(job.status))
        await new Promise((done) => setTimeout(done, 4000));
    } while (!['succeeded', 'failed', 'canceled'].includes(job.status));
    if (job.status !== 'succeeded') {
      await fs.writeFile(receiptPath, JSON.stringify({ ...receipt, state: job.status }, null, 2));
      throw new Error(`${request.name}: generation ${job.status}`);
    }
    const url = Array.isArray(job.output) ? job.output[0] : job.output;
    if (!new URL(url).hostname.endsWith('replicate.delivery'))
      throw new Error('Unexpected asset host');
    const response = await fetch(url);
    if (!response.ok) throw new Error('Asset download failed');
    const bytes = Buffer.from(await response.arrayBuffer());
    const directory = request.name === 'oaxaca-tree' ? 'assets/sources' : 'public/assets';
    const path = `${directory}/${request.name}.${request.input.output_format}`;
    await fs.writeFile(path, bytes);
    await fs.writeFile(
      receiptPath,
      JSON.stringify(
        {
          ...receipt,
          state: job.status,
          path,
          bytes: bytes.length,
          sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
          metrics: job.metrics,
        },
        null,
        2,
      ),
    );
    console.log(`${request.name}: saved ${bytes.length} bytes`);
  }
} else throw new Error('Choose schema or generate-approved-batch');
