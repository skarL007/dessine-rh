import express from 'express';
import routes from './server/app.js';
const app = express();
app.disable('x-powered-by');
app.use(routes);
export default app;
