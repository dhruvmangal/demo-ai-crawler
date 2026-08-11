import { Sequelize } from 'sequelize';
import { env } from './env';

export const sequelize = new Sequelize(env.databaseUrl, {
  dialect: 'postgres',
  logging: false,
  pool: { max: 10, min: 0, idle: 10000 }
});
