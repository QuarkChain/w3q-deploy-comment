import { ethers } from "ethers";
const sha3 = require('js-sha3').keccak_256;

const FileContractInfo = {
  abi: [
    "function write(bytes memory filename, bytes memory data) public payable",
    "function writeChunk(bytes memory name, uint256 chunkId, bytes memory data) public payable",
    "function files(bytes memory filename) public view returns (bytes memory)",
    "function remove(bytes memory name) external returns (uint256)",
    "function countChunks(bytes memory name) external view returns (uint256)",
    "function getChunkHash(bytes memory name, uint256 chunkId) public view returns (bytes32)"
  ],
};

const stringToHex = (s) => ethers.utils.hexlify(ethers.utils.toUtf8Bytes(s));

const FileContract = (address) => {
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  const contract = new ethers.Contract(address, FileContractInfo.abi, provider);
  return contract.connect(provider.getSigner());
};

const readFile = (file) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (res) => {
      resolve(Buffer.from(res.target.result));
    };
    reader.readAsArrayBuffer(file);
  });
}

const bufferChunk = (buffer, chunkSize) => {
  let i = 0;
  let result = [];
  const len = buffer.length;
  const chunkLength = Math.ceil(len / chunkSize);
  while (i < len) {
    result.push(buffer.slice(i, i += chunkLength));
  }
  return result;
}

const request = async ({
  contractAddress,
  dirPath,
  file,
  onSuccess,
  onError,
  onProgress
}) => {
  if (!window.ethereum || !new ethers.providers.Web3Provider(window.ethereum).getSigner()) {
    onError(new Error("Can't find metamask"));
    return;
  }

  const rawFile = file.raw;
  const content = await readFile(rawFile);
  // file name
  const name = dirPath + rawFile.name;
  const hexName = stringToHex(name);
  // Data need to be sliced if file > 475K
  let fileSize = rawFile.size;
  let chunks = [];
  if (fileSize > 475 * 1024) {
    const chunkSize = Math.ceil(fileSize / (475 * 1024));
    chunks = bufferChunk(content, chunkSize);
    fileSize = fileSize / chunkSize;
  } else {
    chunks.push(content);
  }

  let uploadState = true;
  const fileContract = FileContract(contractAddress);
  for (const index in chunks) {
    const chunk = chunks[index];
    let cost = 0;
    if (fileSize > 24 * 1024 - 326) {
      cost = Math.floor((fileSize + 326) / 1024 / 24);
    }
    const hexData = '0x' + chunk.toString('hex');
    const localHash = '0x' + sha3(chunk);
    const hash = await fileContract.getChunkHash(hexName, index);
    if (localHash === hash) {
      console.log(`File ${name} chunkId: ${index}: The data is not changed.`);
      continue;
    }

    try {
      // file is remove or change
      const tx = await fileContract.writeChunk(hexName, index, hexData, {
        value: ethers.utils.parseEther(cost.toString())
      });
      console.log(`Transaction Id: ${tx.hash}`);
      const receipt = await tx.wait();
      if (!receipt.status) {
        uploadState = false;
        break;
      }
      onProgress({ percent: Number(index)});
    } catch (e) {
      uploadState = false;
      break;
    }
  }
  if (uploadState) {
    const url = "https://galileo.web3q.io/" + contractAddress + ":3334/" + name;
    onSuccess({ path: url});
  } else {
    onError(new Error('upload request failed!'));
  }
};

export default request;
