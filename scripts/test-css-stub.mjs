// Stylesheets are Next's job (the bundler compiles them); under the Node test
// runner a component's `import './x.css'` loads as an empty module so pages
// and components can be imported and rendered in behaviour tests.
import { registerHooks } from 'node:module';

registerHooks({
  load(url, context, nextLoad) {
    if (/\.css(?:[?#].*)?$/.test(url)) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
  },
});
