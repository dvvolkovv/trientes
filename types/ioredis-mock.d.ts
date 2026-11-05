// ioredis-mock ships no type declarations. Its instances are drop-in
// replacements for ioredis clients, so borrow that package's types.
declare module "ioredis-mock" {
  import Redis from "ioredis";
  export default Redis;
}
