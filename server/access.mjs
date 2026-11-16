export function allowedAccess(port, extraOrigins = '') {
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`]);
  for (const raw of extraOrigins.split(',').map(value => value.trim()).filter(Boolean)) {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('PERSONA_ALLOWED_ORIGINS에는 HTTPS origin만 입력해 주세요');
    origins.add(url.origin);
  }
  return { origins, hosts: new Set([...origins].map(origin => new URL(origin).host)) };
}
