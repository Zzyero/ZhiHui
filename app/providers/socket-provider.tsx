"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { Socket } from "socket.io-client";
import { socket } from "@/lib/socket";
import { S3FilesData } from "@/app/models/prompt-result";
import { useWorkflowData } from "@/app/providers/workflows-data-provider";
import { IWorkflowResult } from "@/app/interfaces/workflow-history";

enum InferEmitEventEnum {
  ErrorMessage = "infer_error_message",
  ResultMessage = "infer_result_message",
}

interface SocketContextType {
  socket: Socket;
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextType>({
  socket,
  isConnected: false,
});

export const useSocket = () => {
  return useContext(SocketContext);
};

export interface IWSMessage {
  data: any;
  prompt_id: string;
}

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const { addCompletedWorkflow } = useWorkflowData();

  useEffect(() => {
    const onConnect = () => {
      console.log("Socket connected");
      setIsConnected(true);
    };

    const onDisconnect = (reason: string, details: any) => {
      console.log("Socket disconnected", reason, details);
      setIsConnected(false);
    };

    const onErrorMessage = (wsMsg: IWSMessage) => {
      console.error(`error: ${JSON.stringify(wsMsg)}`);
    };

    const onResultMessage = async (data: {
      prompt_id: string,
      completed: boolean,
      status: string,
      execution_time_seconds: number,
      prompt: {
        prompt_id: string,
        [key: string]: any,
      }
      [key: string]: any
    }) => {
      if (data) {
        const fileOutputs: S3FilesData[] = [];
        if (data.outputs) {
          for (const output of data.outputs) {
            if (output.hasOwnProperty("filepath")) {
              fileOutputs.push(new S3FilesData({ ...output, contentType: output.content_type }));
            }
          }
        }

        const result: IWorkflowResult = {
          completed: data.completed,
          executionTimeSeconds: data.execution_time_seconds,
          outputs: fileOutputs,
          prompt: { ...data.prompt, promptId: data.prompt_id },
          promptId: data.prompt_id,
          status: data.status,
          errorData: data.error_data
        }
        addCompletedWorkflow(result);
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err);
      setIsConnected(false);
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });

    socket.on(InferEmitEventEnum.ErrorMessage, onErrorMessage);
    socket.on(InferEmitEventEnum.ResultMessage, onResultMessage);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off(InferEmitEventEnum.ErrorMessage, onErrorMessage);
      socket.off(InferEmitEventEnum.ResultMessage, onResultMessage);
      socket.off('error');
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
};
