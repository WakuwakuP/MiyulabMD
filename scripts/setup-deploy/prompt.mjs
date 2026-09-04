import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";

export function createPrompt() {
  const rl = readline.createInterface({ input, output });

  return {
    async ask(question, defaultValue = "") {
      const hint = defaultValue ? ` [${defaultValue}]` : "";
      const answer = (await rl.question(`${question}${hint}: `)).trim();
      return answer || defaultValue;
    },

    async confirm(question, defaultYes = true) {
      const hint = defaultYes ? "Y/n" : "y/N";
      const answer = (await rl.question(`${question} [${hint}]: `))
        .trim()
        .toLowerCase();
      if (!answer) {
        return defaultYes;
      }
      return answer === "y" || answer === "yes";
    },

    async choose(question, options) {
      if (options.length === 0) {
        throw new Error("選択肢がありません");
      }
      if (options.length === 1) {
        return options[0].value;
      }
      console.log(question);
      options.forEach((option, index) => {
        console.log(`  ${index + 1}) ${option.label}`);
      });
      for (;;) {
        const raw = (await rl.question("番号: ")).trim();
        const index = Number.parseInt(raw, 10) - 1;
        if (options[index]) {
          return options[index].value;
        }
        console.log("一覧の番号を入力してください。");
      }
    },

    async secret(question) {
      rl.pause();
      const value = await readHidden(question);
      rl.resume();
      return value;
    },

    close() {
      rl.close();
    },
  };
}

function readHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = input;
    if (!stdin.isTTY) {
      reject(new Error("対話入力できる端末で実行してください"));
      return;
    }

    output.write(question);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";

    const finish = (result, error) => {
      stdin.setRawMode(wasRaw);
      stdin.off("data", onData);
      output.write("\n");
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    };

    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\n" || ch === "\r") {
          finish(value.trim());
          return;
        }
        if (ch === "\u0003") {
          finish("", new Error("中断されました"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (ch >= " ") {
          value += ch;
        }
      }
    };

    stdin.on("data", onData);
  });
}
