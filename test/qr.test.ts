import { qrSvg } from '@/ui/views/qr-view';

it('does not truncate CJK characters to their low-byte ASCII lookalikes', () => {
  // U+4F60/U+597D have the same low bytes as ASCII backtick/right brace.
  // Encoding these as the same QR silently changes what a scanner receives.
  expect(qrSvg('你好').outerHTML).not.toBe(qrSvg('`}').outerHTML);
});

it('does not truncate a surrogate pair to two unrelated bytes', () => {
  expect(qrSvg('😀').outerHTML).not.toBe(qrSvg('=\0').outerHTML);
});
