import { extractHandshakeToken } from '../../../../src/modules/notifications/infrastructure/adapters/inbound/realtime/WebSocketGateway.js';

describe('extractHandshakeToken', () => {
  it('returns the token carried in Sec-WebSocket-Protocol', () => {
    expect(extractHandshakeToken({ 'sec-websocket-protocol': 'abc.def' })).toBe('abc.def');
  });

  it('returns undefined when the header is missing', () => {
    expect(extractHandshakeToken({})).toBeUndefined();
  });

  it('returns undefined when the header is empty', () => {
    expect(extractHandshakeToken({ 'sec-websocket-protocol': '' })).toBeUndefined();
  });

  it('trims surrounding whitespace from a single-value header', () => {
    expect(extractHandshakeToken({ 'sec-websocket-protocol': '  token-1  ' })).toBe('token-1');
  });

  it('takes the first entry of a comma-separated protocol list', () => {
    expect(extractHandshakeToken({ 'sec-websocket-protocol': 'token-1, token-2' })).toBe('token-1');
  });
});
