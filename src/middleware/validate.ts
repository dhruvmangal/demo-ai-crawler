import { NextFunction, Request, Response } from 'express';
import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { ValidationError } from '../errors/api-error';

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

interface ValidateSchemas {
  body?: object;
  params?: object;
  query?: object;
}

type RequestPart = 'body' | 'params' | 'query';

// Schemas are compiled once, at route-registration time, not per-request.
export function validate(schemas: ValidateSchemas) {
  const compiled: Partial<Record<RequestPart, ValidateFunction>> = {};
  (Object.keys(schemas) as RequestPart[]).forEach(key => {
    const schema = schemas[key];
    if (schema) {
      compiled[key] = ajv.compile(schema);
    }
  });

  return (req: Request, _res: Response, next: NextFunction): void => {
    for (const key of Object.keys(compiled) as RequestPart[]) {
      const validator = compiled[key]!;
      if (!validator(req[key])) {
        throw new ValidationError(`Invalid request ${key}.`, validator.errors);
      }
    }
    next();
  };
}
