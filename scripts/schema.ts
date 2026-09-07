import { z } from 'zod';
import { machineSchema } from '../simulator/schema';
console.log(JSON.stringify(z.toJSONSchema(machineSchema), null, 2));
