import { admin } from './admin';
import { handleEmail } from './email';

export default { fetch: admin.fetch, email: handleEmail } satisfies ExportedHandler<Env>;
