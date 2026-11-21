import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/routes/forms-security.test.ts', 'src/client/form-engagement.test.ts'] },
});
