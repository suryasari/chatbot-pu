import pkg from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import dotenv from "dotenv";
import puppeteer from "puppeteer";
import fs from "fs";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { Document } from "langchain/document";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { TaskType } from "@google/generative-ai";
import { createRetrievalChain } from "langchain/chains/retrieval";

const { Client, LocalAuth } = pkg;

// load environment variables
dotenv.config();

const systemTemplate = `
##Tentang
  Kamu adalah customer service sebuah program Perkuliahan di Telkom University (Tel U) bernama dengan Nama TelUEdu. 

##Tugas
  Tugas kamu adalah menjawab pertanyaan terkait mata kuliah. Kamu hanya menjawab dalam maksimum 1 paragraf saja dengan bahasa Indonesia yang sopan dan ramah tanpa emoticon.

##Panggilan
  Selalu panggil dengan "Kak" atau "Kakak" atau "Juragan" atau "Agan" dan hindari memanggil dengan sebutan "Anda". 

##Batasan
  Jawab hanya yang kamu tahu saja. 
  Tanpa menyebutkan informasi pribadi atau data sensitif.
  kamu dapat meminta pertanyaan lebih spesifik jika diperlukan. tapi jangan terlalu banyak bertanya.
  Arahkan mereka untuk kontak ke info@telu.ac.id jika terdapat kendala. 

##Rekomendasi
  Kamu juga dapat memberikan rekomendasi mata kuliah dari data yang kamu punya jika mereka menanyakan rekomendasi yang diambil. 
  kamu dapat meminta pertanyaan lebih spesifik jika diperlukan. Tanyakan dulu mengenai kenginan profesi dia
  kamu dapat bertanya tentang ketertarikan di bidangnya, 
  kamu dapat bertanya tentang batasan jumlah mata kuliah yang bisa diambil. 
  Kemudian cocokkan dengan data yang kamu punya. Rekomendasikan setidaknya 5 mata kuliah.

##Call to Action
    Arahkan untuk segera mendaftar ke program TeluEdu di telu.ac.id dan hubungi info@telu.ac.id jika terdapat kendala.
   
{context}
`;

// initilize the model
const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.API_KEY,
  model: "gemini-1.5-flash",
  temperature: 0,
});

// memanggil domain knowledge yang telah dibuat 
const domainKnowledge = fs.readFileSync("knowledge_base.txt", "utf-8");

const doc = new Document({
  pageContent: domainKnowledge,
  metadata: {},
});

const embeddings = new GoogleGenerativeAIEmbeddings({
  taskType: TaskType.RETRIEVAL_DOCUMENT,
  apiKey: process.env.API_KEY,
  model: "text-embedding-004",
});
// initialize vector store
const vectorStore = await MemoryVectorStore.fromDocuments([doc], embeddings);
const retriever = vectorStore.asRetriever();

const prompt = ChatPromptTemplate.fromMessages([
    ["system", systemTemplate],
    ["human", "{input}"],
  ]);

// // create the chain

const questionAnswerChain = await createStuffDocumentsChain({
  llm: model,
  prompt,
});

const ragChain = await createRetrievalChain({
  retriever,
  combineDocsChain: questionAnswerChain,
});


// Handle chatbot interactions
async function handleWaChat(inputMessage) {
    try {
      const contextMessage = systemTemplate.replace("{context}", inputMessage);
      const relevantData = await ragChain.invoke({ input: contextMessage });
  
      console.log("Relevant data:", relevantData);
  
      if (relevantData) {
        const prompt = ChatPromptTemplate.fromMessages([
          ["system", relevantData.input, relevantData.answer],
          ["human", "{input}"],
        ]);
  
        const chain = prompt.pipe(model);
  
        const responseText = await chain.invoke({
          input: inputMessage,
        });
  
        console.log("Response text:", responseText);
  
        return responseText.content;
      }
  
      return "Mohon Maaf, saya tidak memiliki jawaban untuk pertanyaan kakak tersebut.";
    } catch (error) {
      //handleError(error);
      return "Maaf, terjadi kesalahan saat memproses permintaan kakak.";
    }
  }

async function main() {
  const apikey = process.env.API_KEY;
  console.log(apikey);
  console.log("Memulakan bot...");
  // disini nanti akan ada kode untuk bot whatsapp
  // create new client
  const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      executablePath: puppeteer.executablePath(),
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    },
  });

  // event listener
  client.on("qr", (qr) => {
    console.log("scan this qr code");
    qrcode.generate(qr, { small: true, errorCorrectionLevel: "H" });
  });

  client.on("ready", () => {
    console.log("bot is ready");
  });

  // Jika pengguna mengetik pertanyaan dengan dimulai dari !q  dalam hal ini question(pertanyaan)

  client.on("message", async (message) => {
    console.log(message.body);
    if (message.body === "ping") {
      message.reply("pong");
    } else if (message.body.startsWith("!q")) {
      
      const humanInput = message.body.replace("!q", "").trim();
      const reply = await handleWaChat(humanInput);
      message.reply(reply);
    }
    
  });

  client.on("auth_failure", () => {
    console.log("auth failure");
  });

  client.on("disconnected", (reason) => {
    console.log("bot disconnected:", reason);
    process.exit();
  });

  // connect to whatsapp
  client.initialize();
}

main();
