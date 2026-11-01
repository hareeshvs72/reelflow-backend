import { z } from 'zod';

/**
 * Factory: returns Express middleware that validates req.body against a Zod schema.
 * On failure, throws with name='ZodError' — caught by errorHandler middleware.
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const err = result.error;
      err.statusCode = 422;
      return next(err);
    }
    req.body = result.data; // Use parsed & coerced data
    next();
  };
}

/**
 * Factory: validates req.query
 */
export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const err = result.error;
      err.statusCode = 422;
      return next(err);
    }
    req.query = result.data;
    next();
  };
}
