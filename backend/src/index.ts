import { makeExecutableSchema } from "@graphql-tools/schema";
import { PrismaClient } from "@prisma/client";
import { ApolloServer } from "@apollo/server";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { expressMiddleware } from "@apollo/server/express4";
import express from "express";
import { PubSub } from "graphql-subscriptions";
import { useServer } from "graphql-ws/lib/use/ws";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { getSession } from "next-auth/react";
import resolvers from "./graphql/resolvers/index";
import typeDefs from "./graphql/typeDefs";
import { GraphQLContext, Session, SubscriptionContext } from "./util/types";
import * as dotenv from "dotenv";
import cors from "cors";
import { json } from "body-parser";

const main = async () => {
  dotenv.config();
  
  // Create the schema
  const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
  });

  const app = express();
  const httpServer = createServer(app);
  const wsServer = new WebSocketServer({
    server: httpServer,
    path: "/graphql/subscriptions",
  });

  const prisma = new PrismaClient();
  const pubsub = new PubSub();

  const getSubscriptionContext = async (ctx: SubscriptionContext): Promise<GraphQLContext> => {
    if (ctx.connectionParams && ctx.connectionParams.session) {
      const { session } = ctx.connectionParams;
      return { session, prisma, pubsub };
    }
    return { session: null, prisma, pubsub };
  };

  const serverCleanup = useServer(
    {
      schema,
      context: (ctx: SubscriptionContext) => getSubscriptionContext(ctx),
    },
    wsServer
  );

  const server = new ApolloServer({
    schema,
    csrfPrevention: true,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await serverCleanup.dispose();
            },
          };
        },
      },
    ],
  });
  await server.start();

  // CORS configuration
  const corsOptions = {
    origin: [
      "https://buzzhub-by-shalini.netlify.app",
      "http://localhost:3000",
    ], // Allow your client URL
    credentials: true,
  };

  // Use CORS middleware before the GraphQL middleware
  app.use(cors(corsOptions));
  app.use(
    "/graphql",
    json(),
    expressMiddleware(server, {
      context: async ({ req }): Promise<GraphQLContext> => {
        const session = await getSession({ req });
        return { session: session as unknown as Session, prisma, pubsub };
      },
    })
  );

  const PORT = 4000;
  await new Promise<void>((resolve) =>
    httpServer.listen({ port: PORT }, resolve)
  );
  console.log(`Server is now running on http://localhost:${PORT}/graphql`);
};

main().catch((err) => console.log(err));
