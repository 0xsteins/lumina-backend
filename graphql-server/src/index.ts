import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { Context, resolvers } from './resolvers';

const typeDefs = readFileSync(join(__dirname, 'schema.graphql'), 'utf-8');

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/lumina';
const PORT = parseInt(process.env.PORT ?? '4000', 10);

const pool = new Pool({ connectionString: DATABASE_URL });

const server = new ApolloServer<Context>({ typeDefs, resolvers });

startStandaloneServer(server, {
  listen: { port: PORT },
  context: async () => ({ pool }),
}).then(({ url }) => {
  console.log(`Lumina GraphQL server running at ${url}`);
  console.log(`Database: ${DATABASE_URL}`);
});
