import express from 'express';
import { reports } from './routes/reports';
import { tasks } from './routes/tasks';

const app = express();
app.use(express.json());
app.use('/tasks', tasks);
app.use('/reports', reports);
app.listen(Number(process.env.PORT ?? 3000));
