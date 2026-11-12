import 'dotenv/config';
import express from 'express';
import { resolve } from 'node:path';
import app from '../server/app.js';

const port=Number(process.env.PORT||3000);
app.use(express.static(resolve('public')));
app.get('/{*splat}',(_req,res)=>res.sendFile(resolve('public/index.html')));
app.listen(port,'0.0.0.0',()=>console.log(`Dessine RH listening on port ${port}.`));
