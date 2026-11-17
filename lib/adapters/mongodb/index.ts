import { createRemoteAdapter } from "../remote";
export const mongodbAdapter = createRemoteAdapter({ engine: "mongodb", displayName: "MongoDB", defaultPort: 27017 });
