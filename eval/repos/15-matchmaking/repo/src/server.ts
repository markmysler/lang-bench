import express from 'express';
import { accounts } from './accounts';
import { inventory } from './inventory';

const app = express();
app.use(express.json());
app.use('/accounts', accounts);
app.use('/inventory', inventory);
app.listen(Number(process.env.PORT ?? 8080));
