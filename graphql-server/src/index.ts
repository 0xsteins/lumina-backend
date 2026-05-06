import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolvers } from './resolvers';

const typeDefs = readFileSync(join(__dirname, 'schema.graphql'), 'utf-8');

const server = new ApolloServer({ typeDefs, resolvers });

const PORT = parseInt(process.env.PORT ?? '4000', 10);

startStandaloneServer(server, {
  listen: { port: PORT },
}).then(({ url }) => {
  console.log(`Lumina GraphQL server running at ${url}`);
});
