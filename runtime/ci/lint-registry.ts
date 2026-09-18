import { lintRegistry, loadRegistry } from '../registry';

const registry = await loadRegistry();
const errors = await lintRegistry(registry);

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exitCode = 1;
} else {
  console.log('SOURCE_REGISTRY integrity: OK');
}
