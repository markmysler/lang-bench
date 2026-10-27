import express from 'express';
import { projects } from './routes/projects';
import { tasks } from './routes/tasks';

const app = express();
app.use(express.json());
app.use('/projects', projects);
app.use('/tasks', tasks);
app.listen(Number(process.env.PORT ?? 3000));
