(function() {
  const NAME = "qr_create";

  const DEFAULT_SIZE = '200x200';

  function sanitizeData(data) {
    try {
      return String(data == null ? '' : data).slice(0, 1024);
    } catch (_) {
      return '';
    }
  }

  function clampSize(size) {
    if (!size) return DEFAULT_SIZE;
    const m = String(size).trim().match(/^(\d{1,4})x(\d{1,4})$/);
    if (!m) return DEFAULT_SIZE;
    const w = Math.min(2048, Math.max(32, parseInt(m[1], 10)));
    const h = Math.min(2048, Math.max(32, parseInt(m[2], 10)));
    return `${w}x${h}`;
  }

  self.QRCreateTool = {
    name: NAME,
    description: "Create a QR code image URL (PNG) via api.qrserver.com (no key). Returns a direct image URL you can show or download.",
    parameters: {
      type: 'object',
      properties: {
        data: { type: 'string', minLength: 1, description: 'Text or URL to encode into the QR.' },
        size: { type: 'string', default: '200x200', description: 'Image size WIDTHxHEIGHT, e.g., 200x200 (max 2048x2048).'},
        margin: { type: 'integer', minimum: 0, maximum: 20, default: 2, description: 'Quiet zone margin (0-20).'}
      },
      required: ['data']
    },
    async execute({ data, size = '200x200', margin = 2 }) {
      try {
        const payload = sanitizeData(data);
        if (!payload) return { error: 'empty_data' };
        const sz = clampSize(size);
        const m = Math.max(0, Math.min(20, Number.isFinite(margin) ? margin : 2));
        const url = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(payload)}&size=${encodeURIComponent(sz)}&margin=${encodeURIComponent(String(m))}`;
        // No need to fetch; return URL for the client to show or download
        return { url, bytes: null, content_type: 'image/png', inline: true };
      } catch (e) {
        return { error: String(e && e.message || e) };
      }
    }
  };

  try { if (typeof self.registerTool === 'function') self.registerTool(self.QRCreateTool); } catch (_) {}
})();


