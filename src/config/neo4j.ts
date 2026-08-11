import neo4j, { Driver } from 'neo4j-driver';
import './env';

const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
const user = process.env.NEO4J_USER || 'neo4j';
const password = process.env.NEO4J_PASSWORD || 'crawler_neo4j_password';

let driver: Driver | null = null;

export const getNeo4jDriver = (): Driver => {
  if (!driver) {
    driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }
  return driver;
};

export const closeNeo4jDriver = async () => {
  if (driver) {
    await driver.close();
    driver = null;
  }
};
