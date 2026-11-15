import { parseWith } from '../shared/index.js';
import { type OneClickStatusResponse, oneClickStatusResponseSchema } from './oneclick.js';

export function parseOneClickStatus(value: unknown): OneClickStatusResponse {
  return parseWith(oneClickStatusResponseSchema, value, '1Click status');
}
