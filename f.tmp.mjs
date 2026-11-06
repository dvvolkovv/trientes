import { PrismaClient } from "@prisma/client";
const p=new PrismaClient();
const f=await p.fintechCompany.findFirst({where:{status:"APPROVED",description:{not:null}},select:{slug:true}});
console.log(f?.slug ?? "none");
await p.$disconnect();
