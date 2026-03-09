import * as dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
dotenv.config();

// Define schema for environment validation
const envSchema = z.object({
  NODE_ENV: z.enum(['production', 'staging', 'development']),
  PORT: z.coerce.number().default(3000),
  DB_URI: z.string().url(),
  // Add more environment variables as needed
});

// Validate environment variables
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:', parsedEnv.error.format());
  process.exit(1);
} else {
  console.log('✅ Environment variables are valid');
}

// Export validated environment variables
const env = parsedEnv.data;
export default env;
