import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import type { MessageBus } from "./message-bus.js";
import type { MonitorRequest, AnalysisResult } from "./types.js";
import { MonitorRequestSchema } from "./types.js";

export interface SqsBusOptions {
  inputQueueUrl: string;
  outputQueueUrl: string;
  region?: string;
  client?: SQSClient;
}

export class SqsBus implements MessageBus {
  private client: SQSClient;
  private inputQueueUrl: string;
  private outputQueueUrl: string;
  private running = false;

  constructor(options: SqsBusOptions) {
    this.client =
      options.client ?? new SQSClient({ region: options.region ?? "us-east-1" });
    this.inputQueueUrl = options.inputQueueUrl;
    this.outputQueueUrl = options.outputQueueUrl;
  }

  async consume(handler: (msg: MonitorRequest) => Promise<void>): Promise<void> {
    this.running = true;

    while (this.running) {
      const response = await this.client.send(
        new ReceiveMessageCommand({
          QueueUrl: this.inputQueueUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 20,
          MessageAttributeNames: ["All"],
        })
      );

      if (!response.Messages || response.Messages.length === 0) {
        continue;
      }

      for (const sqsMessage of response.Messages) {
        if (!sqsMessage.Body) continue;

        const parsed = MonitorRequestSchema.safeParse(
          JSON.parse(sqsMessage.Body)
        );

        if (!parsed.success) {
          console.error(
            "Invalid message, skipping:",
            parsed.error.format()
          );
          // Delete invalid messages so they don't block the queue
          if (sqsMessage.ReceiptHandle) {
            await this.client.send(
              new DeleteMessageCommand({
                QueueUrl: this.inputQueueUrl,
                ReceiptHandle: sqsMessage.ReceiptHandle,
              })
            );
          }
          continue;
        }

        await handler(parsed.data);

        // Delete message after successful processing
        if (sqsMessage.ReceiptHandle) {
          await this.client.send(
            new DeleteMessageCommand({
              QueueUrl: this.inputQueueUrl,
              ReceiptHandle: sqsMessage.ReceiptHandle,
            })
          );
        }
      }
    }
  }

  async publish(result: AnalysisResult): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.outputQueueUrl,
        MessageBody: JSON.stringify(result),
        MessageAttributes: {
          type: {
            DataType: "String",
            StringValue: result.type,
          },
          experimentKey: {
            DataType: "String",
            StringValue: result.experimentKey,
          },
        },
      })
    );
  }

  async close(): Promise<void> {
    this.running = false;
  }
}
