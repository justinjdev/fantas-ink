import type { VercelRequest, VercelResponse } from '@vercel/node'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1115; color: #e6e6e6; margin: 0; padding: 2rem 1rem; display: flex; justify-content: center; }
  main { max-width: 40rem; width: 100%; }
  h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
  p { line-height: 1.5; color: #b5b8c0; }
  .code-block { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 1.1rem; background: #1b1e26; border: 1px solid #2c2f3a; border-radius: 8px; padding: 1rem; margin: 1rem 0; word-break: break-all; user-select: all; }
  .error-block { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 0.95rem; background: #2a1518; border: 1px solid #5a2a2f; color: #f0b4ba; border-radius: 8px; padding: 1rem; margin: 1rem 0; white-space: pre-wrap; word-break: break-word; }
  button { font-size: 1rem; padding: 0.6rem 1.2rem; border-radius: 6px; border: none; background: #4f7cff; color: white; cursor: pointer; }
  button:active { background: #3d63d6; }
  .status { margin-left: 0.75rem; color: #7fd18a; font-size: 0.9rem; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store')

  const code = firstString(req.query.code)
  const error = firstString(req.query.error)
  const errorDescription = firstString(req.query.error_description)

  if (code) {
    const safeCode = escapeHtml(code)
    const html = page(
      'Yahoo OAuth code',
      `<h1>Use this code</h1>
<p>Paste this into the setup script prompt.</p>
<div class="code-block" id="code">${safeCode}</div>
<button id="copy-btn" onclick="copyCode()">Copy to clipboard</button>
<span class="status" id="status"></span>
<script>
function copyCode() {
  var el = document.getElementById('code');
  var text = el.textContent;
  var status = document.getElementById('status');
  function showCopied() {
    status.textContent = 'Copied!';
    setTimeout(function () { status.textContent = ''; }, 2000);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(showCopied, function () {
      fallbackSelect(el, status);
    });
  } else {
    fallbackSelect(el, status);
  }
}
function fallbackSelect(el, status) {
  var range = document.createRange();
  range.selectNodeContents(el);
  var sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  status.textContent = 'Selected, press Cmd/Ctrl+C';
}
</script>`
    )
    res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(html)
    return
  }

  if (error) {
    const safeError = escapeHtml(error)
    const safeDescription = errorDescription ? escapeHtml(errorDescription) : ''
    const html = page(
      'Yahoo OAuth error',
      `<h1>Authorization failed</h1>
<div class="error-block">${safeError}${safeDescription ? '\n\n' + safeDescription : ''}</div>`
    )
    res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(html)
    return
  }

  const html = page('Yahoo OAuth callback', `<h1>No code present</h1>\n<p>This page expects a <code>code</code> query parameter from Yahoo's OAuth redirect.</p>`)
  res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8').send(html)
}
