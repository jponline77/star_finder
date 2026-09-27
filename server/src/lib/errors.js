/** An error that maps directly to an HTTP response `{ error, details? }`. */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   * @param {Record<string, string>} [details]
   * @param {Record<string, unknown>} [extra] extra top-level JSON fields
   */
  constructor(status, message, details, extra) {
    super(message);
    this.status = status;
    this.details = details;
    this.extra = extra;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const forbidden = (message) => new HttpError(403, message);
export const conflict = (message, details, extra) => new HttpError(409, message, details, extra);
export const unauthorized = (message = 'Please log in first') => new HttpError(401, message);
