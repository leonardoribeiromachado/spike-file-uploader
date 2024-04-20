import axios from "axios";
import { ChangeEvent, useState } from "react";
import SparkMD5 from "spark-md5";

type FileMetadata = {
  size: number;
  chunks: number;
  signature: string;
};

type ServerFileMetadataOutput = {
  exists: boolean;
  uploaded_chunks: number;
};

function App() {
  const [file, set_file] = useState<File | undefined>();
  const [file_metadata, set_file_metadata] = useState<
    FileMetadata | undefined
  >();
  const [uploading, set_uploading] = useState(false);
  const [working, set_working] = useState(false);
  const [progress, set_progress] = useState(0);
  const chunkSize = 1024 * 1024 * 10; // 10MB chunks

  const on_file_change = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) {
      alert("Erro ao efetuar upload do arquivo");
      return;
    }
    set_file(files[0]);
  };

  const on_working = async () => {
    set_working(true);
    const file_size = file!.size;
    const chunks = Math.ceil(file_size / chunkSize);

    const spark = new SparkMD5.ArrayBuffer();

    let offset = 0;
    const loadNextChunk = () => {
      const reader = new FileReader();

      reader.onload = () => {
        if (!reader.result || !(reader.result instanceof ArrayBuffer)) {
          throw new Error("Failed to read chunk");
        }

        spark.append(reader.result as ArrayBuffer);
        offset++;

        if (offset < chunks) {
          loadNextChunk();
        } else {
          const signature = spark.end();

          const file_metadata = {
            size: file_size,
            chunks: chunks,
            signature,
          } as FileMetadata;

          console.log(file_metadata);
          set_file_metadata(file_metadata);
          set_working(false);
        }
      };

      reader.onerror = (error) => {
        throw error;
      };

      const leftPtr = offset * chunkSize;
      const ptrLen = leftPtr + chunkSize;
      const rightPtr = ptrLen >= file_size ? file_size : ptrLen;
      const chunk: Blob = file!.slice(leftPtr, rightPtr);

      reader.readAsArrayBuffer(chunk);
    };

    loadNextChunk();
  };

  const getChunkSignature = async (chunk: Blob): Promise<string> => {
    const spark = new SparkMD5.ArrayBuffer();

    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async () => {
        if (!reader.result || !(reader.result instanceof ArrayBuffer)) {
          reject(new Error("Failed to read chunk"));
        }

        spark.append(reader.result as ArrayBuffer);
        resolve(spark.end());
      };

      reader.onerror = (error) => {
        reject(error);
      };

      reader.readAsArrayBuffer(chunk);
    });
  };

  const getServerMetadata = async (
    input: FileMetadata
  ): Promise<ServerFileMetadataOutput> => {
    try {
      const { data } = await axios.post<ServerFileMetadataOutput>(
        "http://localhost:5000/files",
        input
      );
      return data;
    } catch (error) {
      throw new Error("Erro ao enviar metadados do arquivo");
    }
  };

  const onSubmit = async () => {
    set_uploading(true);
    const { size, chunks, signature } = file_metadata!;

    const { exists, uploaded_chunks } = await getServerMetadata({
      size,
      chunks,
      signature,
    });

    if (uploaded_chunks === chunks) {
      alert("Documento já carregado!");
      return;
    }

    console.log({ exists, uploaded_chunks });

    let offset = uploaded_chunks ? uploaded_chunks + 1 : 0;
    const uploadChunk = async () => {
      const leftPtr = offset * chunkSize;
      const ptrLen = leftPtr + chunkSize;
      const rightPtr = ptrLen >= size ? size : ptrLen;

      const formData = new FormData();
      const chunk: Blob = file!.slice(leftPtr, rightPtr);
      const chunk_signature = await getChunkSignature(chunk);

      formData.append("signature", chunk_signature);
      formData.append("position", `${offset}`);
      formData.append("chunk", chunk);
      formData.append("size", String(rightPtr));

      set_progress((offset / chunks) * 100);
      try {
        const { data } = await axios.put(
          `http://localhost:5000/uploads/${signature}`,
          formData,
          {
            headers: {
              "Content-Type": "multipart/form-data",
            },
          }
        );
        console.log(data);

        if (rightPtr < size) {
          offset++;
          uploadChunk();
        } else {
          set_uploading(false);
        }
      } catch (error) {
        console.error("Erro ao fazer upload do chunk", error);
        set_uploading(false);
      }
    };

    await uploadChunk();
  };

  return (
    <div>
      <input type="file" onChange={on_file_change} />
      {file && !file_metadata && !working && (
        <button onClick={on_working}>Carregar</button>
      )}
      {file && file_metadata && !uploading &&  (
        <button onClick={onSubmit} disabled={!file || uploading}>
          Enviar
        </button>
      )}
      {working && <p>Calculando Assinatura do arquivo...</p>}
      {uploading && <p>Carregando: {progress.toFixed(2)}%</p>}
    </div>
  );
}

export default App;
