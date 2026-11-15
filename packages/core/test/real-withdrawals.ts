export const REAL_TIP_HEIGHT = 975946;

export type RealRecipientKind = 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2wsh' | 'p2tr';

export interface RealWithdrawal {
  id: number;
  outcome: 'accepted' | 'rejected';
  kind: RealRecipientKind;
  direct: boolean;
  requestTxid: string;
  sender: string;
  amountSats: number;
  maxFeeSats: number;
  burnHeight: number;
  version: string;
  hashbytes: string;
  scriptPubKey: string;
  address: string | null;
  payoutTxid: string | null;
  payoutVout: number | null;
  feeSats: number | null;
  acceptTxid: string | null;
  requestTx: unknown;
  requestRawTx: string;
  getWithdrawalRequest: string;
  getSweepData: string;
  emily: unknown;
  acceptTx: unknown;
  btcTx: unknown;
  btcTxHex: string | null;
}

export interface RealFailedRequest {
  txid: string;
  requestTx: unknown;
  requestRawTx: string;
}

export const REAL_WITHDRAWALS: readonly RealWithdrawal[] = [
  {
    id: 5131,
    outcome: 'accepted',
    kind: 'p2sh',
    direct: true,
    requestTxid: '4a110223bf000507e3a7bd17b729d649ef3ba88d73a70b9072aef6444433f623',
    sender: 'SP2RY5ESETDZAXQ7XWEGN7Q4X7VFAQ13VWHY7CCQ6',
    amountSats: 1854385,
    maxFeeSats: 4115,
    burnHeight: 975450,
    version: '01',
    hashbytes: 'eb1bd00d971f2500dc2c1653ffd794825675fa24',
    scriptPubKey: 'a914eb1bd00d971f2500dc2c1653ffd794825675fa2487',
    address: '3P8A35s9V37SqKgsQ9bPxQgdzsou3U2UNY',
    payoutTxid: 'db0aaf0bb9a073cf2f72a491447d44915fd5d1b40c20e8f077be374c333b4bde',
    payoutVout: 2,
    feeSats: 1455,
    acceptTxid: '48bf212da1ca1d70b48cfc7ede578b00dcd2445ac07827677c6770b578dfd412',
    requestTx: {
      tx_id: '0x4a110223bf000507e3a7bd17b729d649ef3ba88d73a70b9072aef6444433f623',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SP2RY5ESETDZAXQ7XWEGN7Q4X7VFAQ13VWHY7CCQ6',
      sponsored: false,
      nonce: 87,
      fee_rate: '3000',
      block_height: 9462854,
      burn_block_height: 975450,
      tx_result: {
        hex: '0x07010000000000000000000000000000140b',
        repr: '(ok u5131)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'initiate-withdrawal-request',
        function_signature:
          '(define-public (initiate-withdrawal-request (amount uint) (recipient (tuple (hashbytes (buff 32)) (version (buff 1)))) (max-fee uint)))',
        function_args: [
          {
            hex: '0x01000000000000000000000000001c4bb1',
            repr: 'u1854385',
            name: 'amount',
            type: 'uint',
          },
          {
            hex: '0x0c00000002096861736862797465730200000014eb1bd00d971f2500dc2c1653ffd794825675fa240776657273696f6e020000000101',
            repr: '(tuple (hashbytes 0xeb1bd00d971f2500dc2c1653ffd794825675fa24) (version 0x01))',
            name: 'recipient',
            type: '(tuple (hashbytes (buff 32)) (version (buff 1)))',
          },
          {
            hex: '0x0100000000000000000000000000001013',
            repr: 'u4115',
            name: 'max-fee',
            type: 'uint',
          },
        ],
      },
      post_condition_mode: 'deny',
      post_conditions: [
        {
          principal: {
            type_id: 'principal_standard',
            address: 'SP2RY5ESETDZAXQ7XWEGN7Q4X7VFAQ13VWHY7CCQ6',
          },
          condition_code: 'sent_equal_to',
          amount: '1858500',
          type: 'fungible',
          asset: {
            asset_name: 'sbtc-token',
            contract_address: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4',
            contract_name: 'sbtc-token',
          },
        },
      ],
      events: [
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          tx_id: '0x4a110223bf000507e3a7bd17b729d649ef3ba88d73a70b9072aef6444433f623',
          asset: {
            asset_event_type: 'burn',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token',
            sender: 'SP2RY5ESETDZAXQ7XWEGN7Q4X7VFAQ13VWHY7CCQ6',
            recipient: '',
            amount: '1858500',
          },
        },
        {
          event_index: 1,
          event_type: 'fungible_token_asset',
          tx_id: '0x4a110223bf000507e3a7bd17b729d649ef3ba88d73a70b9072aef6444433f623',
          asset: {
            asset_event_type: 'mint',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token-locked',
            sender: '',
            recipient: 'SP2RY5ESETDZAXQ7XWEGN7Q4X7VFAQ13VWHY7CCQ6',
            amount: '1858500',
          },
        },
        {
          event_index: 2,
          event_type: 'smart_contract_log',
          tx_id: '0x4a110223bf000507e3a7bd17b729d649ef3ba88d73a70b9072aef6444433f623',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c0000000706616d6f756e7401000000000000000000000000001c4bb10c626c6f636b2d68656967687401000000000000000000000000000ee25a076d61782d666565010000000000000000000000000000101309726563697069656e740c00000002096861736862797465730200000014eb1bd00d971f2500dc2c1653ffd794825675fa240776657273696f6e0200000001010a726571756573742d6964010000000000000000000000000000140b0673656e6465720516b1e2bb2ed37eaedcfde3a153dc9d3edeab847be405746f7069630d000000117769746864726177616c2d637265617465',
              repr: '(tuple (amount u1854385) (block-height u975450) (max-fee u4115) (recipient (tuple (hashbytes 0xeb1bd00d971f2500dc2c1653ffd794825675fa24) (version 0x01))) (request-id u5131) (sender \'SP2RY5ESETDZAXQ7XWEGN7Q4X7VFAQ13VWHY7CCQ6) (topic "withdrawal-create"))',
            },
          },
        },
      ],
      event_count: 3,
      vm_error: null,
    },
    requestRawTx:
      '0x00000000010400b1e2bb2ed37eaedcfde3a153dc9d3edeab847be400000000000000570000000000000bb80001fb888a6306437e4bffcc7a98e70eac73a44edf6c35600619589eafff2976eb874df3f7d961b81571fee64cde849952b72f8dfd244312945fd0de25bacf70e4d4030200000001010216b1e2bb2ed37eaedcfde3a153dc9d3edeab847be414f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0a736274632d746f6b656e0a736274632d746f6b656e0100000000001c5bc40214f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0f736274632d7769746864726177616c1b696e6974696174652d7769746864726177616c2d726571756573740000000301000000000000000000000000001c4bb10c00000002096861736862797465730200000014eb1bd00d971f2500dc2c1653ffd794825675fa240776657273696f6e0200000001010100000000000000000000000000001013',
    getWithdrawalRequest:
      '0x0a0c0000000606616d6f756e7401000000000000000000000000001c4bb10c626c6f636b2d68656967687401000000000000000000000000000ee25a076d61782d666565010000000000000000000000000000101309726563697069656e740c00000002096861736862797465730200000014eb1bd00d971f2500dc2c1653ffd794825675fa240776657273696f6e0200000001010673656e6465720516b1e2bb2ed37eaedcfde3a153dc9d3edeab847be4067374617475730a03',
    getSweepData:
      '0x0a0c000000030f73776565702d6275726e2d6861736802000000200000000000000000000176e5871d85b8b7e3cb628ed6333bc082c047e15f4c3f1173776565702d6275726e2d68656967687401000000000000000000000000000ee2630a73776565702d747869640200000020db0aaf0bb9a073cf2f72a491447d44915fd5d1b40c20e8f077be374c333b4bde',
    emily: {
      requestId: 5131,
      stacksBlockHash: '7a35bac8fa08cb16b7d777d669e7a40102b7da7a1bfb7dfb99b38813b51b42e2',
      stacksBlockHeight: 9462854,
      recipient: 'a914eb1bd00d971f2500dc2c1653ffd794825675fa2487',
      sender: 'SP2RY5ESETDZAXQ7XWEGN7Q4X7VFAQ13VWHY7CCQ6',
      amount: 1854385,
      lastUpdateHeight: 9463392,
      lastUpdateBlockHash: '0b72873aaf7004a0ed589e41bb5405a3d3d80378089416600c6040de58382782',
      status: 'confirmed',
      statusMessage:
        'Included in block 0b72873aaf7004a0ed589e41bb5405a3d3d80378089416600c6040de58382782',
      parameters: {
        maxFee: 4115,
      },
      fulfillment: {
        BitcoinTxid: 'db0aaf0bb9a073cf2f72a491447d44915fd5d1b40c20e8f077be374c333b4bde',
        BitcoinTxIndex: 2,
        StacksTxid: '48bf212da1ca1d70b48cfc7ede578b00dcd2445ac07827677c6770b578dfd412',
        BitcoinBlockHash: '0000000000000000000176e5871d85b8b7e3cb628ed6333bc082c047e15f4c3f',
        BitcoinBlockHeight: 975459,
        BtcFee: 1455,
      },
      expectedFulfillmentInfo: {
        bitcoinBlockHeight: 975457,
        bitcoinTxid: 'db0aaf0bb9a073cf2f72a491447d44915fd5d1b40c20e8f077be374c333b4bde',
      },
      txid: '4a110223bf000507e3a7bd17b729d649ef3ba88d73a70b9072aef6444433f623',
    },
    acceptTx: {
      tx_id: '0x48bf212da1ca1d70b48cfc7ede578b00dcd2445ac07827677c6770b578dfd412',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SM37A2MMXMKEHTZ0N6N81TFF4XEA62J2ZR3NM7BW8',
      sponsored: false,
      nonce: 25882,
      fee_rate: '5837',
      block_height: 9463392,
      burn_block_height: 975459,
      tx_result: {
        hex: '0x0703',
        repr: '(ok true)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'accept-withdrawal-request',
        function_signature:
          '(define-public (accept-withdrawal-request (request-id uint) (bitcoin-txid (buff 32)) (signer-bitmap uint) (output-index uint) (fee uint) (burn-hash (buff 32)) (burn-height uint) (sweep-txid (buff 32))))',
        function_args: [
          {
            hex: '0x010000000000000000000000000000140b',
            repr: 'u5131',
            name: 'request-id',
            type: 'uint',
          },
          {
            hex: '0x0200000020db0aaf0bb9a073cf2f72a491447d44915fd5d1b40c20e8f077be374c333b4bde',
            repr: '0xdb0aaf0bb9a073cf2f72a491447d44915fd5d1b40c20e8f077be374c333b4bde',
            name: 'bitcoin-txid',
            type: '(buff 32)',
          },
          {
            hex: '0x0100000000000000000000000000000000',
            repr: 'u0',
            name: 'signer-bitmap',
            type: 'uint',
          },
          {
            hex: '0x0100000000000000000000000000000002',
            repr: 'u2',
            name: 'output-index',
            type: 'uint',
          },
          {
            hex: '0x01000000000000000000000000000005af',
            repr: 'u1455',
            name: 'fee',
            type: 'uint',
          },
          {
            hex: '0x02000000200000000000000000000176e5871d85b8b7e3cb628ed6333bc082c047e15f4c3f',
            repr: '0x0000000000000000000176e5871d85b8b7e3cb628ed6333bc082c047e15f4c3f',
            name: 'burn-hash',
            type: '(buff 32)',
          },
          {
            hex: '0x01000000000000000000000000000ee263',
            repr: 'u975459',
            name: 'burn-height',
            type: 'uint',
          },
          {
            hex: '0x0200000020db0aaf0bb9a073cf2f72a491447d44915fd5d1b40c20e8f077be374c333b4bde',
            repr: '0xdb0aaf0bb9a073cf2f72a491447d44915fd5d1b40c20e8f077be374c333b4bde',
            name: 'sweep-txid',
            type: '(buff 32)',
          },
        ],
      },
      post_condition_mode: 'allow',
      post_conditions: [],
      events: [
        {
          event_index: 2,
          event_type: 'smart_contract_log',
          tx_id: '0x48bf212da1ca1d70b48cfc7ede578b00dcd2445ac07827677c6770b578dfd412',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c000000090c626974636f696e2d747869640200000020db0aaf0bb9a073cf2f72a491447d44915fd5d1b40c20e8f077be374c333b4bde096275726e2d6861736802000000200000000000000000000176e5871d85b8b7e3cb628ed6333bc082c047e15f4c3f0b6275726e2d68656967687401000000000000000000000000000ee2630366656501000000000000000000000000000005af0c6f75747075742d696e64657801000000000000000000000000000000020a726571756573742d6964010000000000000000000000000000140b0d7369676e65722d6269746d617001000000000000000000000000000000000a73776565702d747869640200000020db0aaf0bb9a073cf2f72a491447d44915fd5d1b40c20e8f077be374c333b4bde05746f7069630d000000117769746864726177616c2d616363657074',
              repr: '(tuple (bitcoin-txid 0xdb0aaf0bb9a073cf2f72a491447d44915fd5d1b40c20e8f077be374c333b4bde) (burn-hash 0x0000000000000000000176e5871d85b8b7e3cb628ed6333bc082c047e15f4c3f) (burn-height u975459) (fee u1455) (output-index u2) (request-id u5131) (signer-bitmap u0) (sweep-txid 0xdb0aaf0bb9a073cf2f72a491447d44915fd5d1b40c20e8f077be374c333b4bde) (topic "withdrawal-accept"))',
            },
          },
        },
      ],
      event_count: 3,
      vm_error: null,
    },
    btcTx: {
      txid: 'db0aaf0bb9a073cf2f72a491447d44915fd5d1b40c20e8f077be374c333b4bde',
      weight: 1511,
      fee: 1455,
      vin: [
        {
          txid: 'f8c7ca391baaefadb02343217a35568831bcefaa7ca90e9efc113b55bfce3fbe',
          vout: 0,
        },
      ],
      vout: [
        {
          scriptpubkey: '51208056b53d7e41f8f80b4a2daa457b07f81b1b5f42036152c7d055cd9c7fcdf753',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1psptt20t7g8u0sz629k4y27c8lqd3kh6zqds4937s2hxecl7d7afsrhteyx',
          value: 247886592259,
        },
        {
          scriptpubkey: '6a065433018b2800',
          scriptpubkey_type: 'op_return',
          value: 0,
        },
        {
          scriptpubkey: 'a914eb1bd00d971f2500dc2c1653ffd794825675fa2487',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3P8A35s9V37SqKgsQ9bPxQgdzsou3U2UNY',
          value: 1854385,
        },
      ],
      status: {
        confirmed: true,
        block_height: 975459,
        block_hash: '0000000000000000000176e5871d85b8b7e3cb628ed6333bc082c047e15f4c3f',
        block_time: 1794419113,
      },
    },
    btcTxHex:
      '02000000000101be3fcebf553b11fc9e0ea97caaefbc318856357a214323b0adefaa1b39cac7f800000000000000000003033931b7390000002251208056b53d7e41f8f80b4a2daa457b07f81b1b5f42036152c7d055cd9c7fcdf7530000000000000000086a065433018b2800b14b1c000000000017a914eb1bd00d971f2500dc2c1653ffd794825675fa24870d0040ea7a09e867a1eee4310717da7204f0e64314a49d678bccb9f1049c447c7647c88a6cd498e1248ae2112d4521a92fc64392a69a4f97fd92710111ac74b75f0d8f408a97bf87394e3d3bf303546b5db029da0278815506c42e2f6dc494504820d9d20a2f50537400f0c0212dc80699ae1c116f87371dbe5bcec4e1dd5daebc65f258409cb03f12fdb1d3c181afb2bfdcda52ad4962dd14708ade343c859abd272a22ff11ac6de1c5483383b9ee693ebc329f90685911851828f19a0b76deb740dc17b300401eccee6ae493145e9a0d57e6ae05f0922350bd39f8f7447d0ed04c3ddac684880dd7d55b60555c354f57b2597130e439f4120680966b9cec0dc243815507fa1c40f470c23fda2a5627df6d8b265a581da28e2ad5b3875a3d83667fa6eae2d99f327525f3109fc8e259608c7bc96a975a2b23e670a4e7ac3bf82728cf738ec63663407c3da70980345341ee91d57e7fd47ea766319940680032fc2ec245edec6b540a7243c2a6a8c7a64d2bcf176f8ed8741a0f89472748a0fa09fedd95a6cac202b140d21d728157b62e0ae28bf0a08f896558e95f65e4b2eeb4988e381d926430dffaaefcb06adf66b6681f8a06bb393352b2e730968067de3f2197f54223428ef4c94024b1d30c896304a7f6d572027ea43ff173b7f31be32cb50f9da129798b19d509e5b8303fc9977d7353e702a2d485ef0b149b986b4d9fdfc629d68d29eb131c1400fd780120045a602c7d83dfd1e7f576f611a26bbf7eae6d6b5f0a022b75684ffe4a8e5432ac201a39d16a6ffaa40fe404e64bc373c47bae126bd3d96dfcac5aa9c2137e089888ba201b6bf6534a8d3176db2e31063db3b1f35221c424306ee9a6b4ac50a46e7ee02eba202772abd64d7d82fa22700ebc9575d69548b699c04201f0d77e8e9602f58d8b64ba204505a302b1e030f1220b4e489c5ee28b855a4060e5a5e13fc739850b413a3121ba207a63f798bdcc5857c12c345f8373ba9167a93f431a3fe8be4fd74f9bbc0076fdba207b3e2369356df5edf768a5218f49c2a1ab871b46550d7ec8156bf2b378b38020ba20852d177ca592ee878b1272d6d166b694d5d419c07508246b07656c22f46b807bba20a3cc2583c4f46a92edace6621fa9dc592dd2fb674d7c5af6e59303f8648bd58eba20ac681c61c24074c42834d798b07d2ab5bdb6da7ea493f25cb3e691ceed663b33ba20ad20fef55bdcb8e14bf9c2de447b20ab36b3cd05261c7fc1e936f94d3514f7d2ba589c21c14a30b2e461b280c0b13a03799096ab1256589153fc4b9c8cead16dc0b642069700000000',
  },
  {
    id: 5137,
    outcome: 'accepted',
    kind: 'p2sh',
    direct: true,
    requestTxid: '13aada287839fe499f4c3843268f7534343f02d06f061be5af585981d1e7681f',
    sender: 'SP183Z0FZB67F4MX82PNXG2BK9KPESRA51ZDF196J',
    amountSats: 10449,
    maxFeeSats: 1646,
    burnHeight: 975554,
    version: '01',
    hashbytes: '4902d93a2b21adc36225c6479aa0555a9e35bf9f',
    scriptPubKey: 'a9144902d93a2b21adc36225c6479aa0555a9e35bf9f87',
    address: '38M4fU5VbuLWiXB24YQvfbbw56stJADdxr',
    payoutTxid: 'bdfee68285019235389c350de07167dbaf3331f02f6a0dcdb5a9ffce0fa0b00d',
    payoutVout: 2,
    feeSats: 88,
    acceptTxid: '348c5212f78efec9604b0799ebdad8a064ba8750c77b658eb8245f813d8cb62c',
    requestTx: {
      tx_id: '0x13aada287839fe499f4c3843268f7534343f02d06f061be5af585981d1e7681f',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SP183Z0FZB67F4MX82PNXG2BK9KPESRA51ZDF196J',
      sponsored: false,
      nonce: 11,
      fee_rate: '3000',
      block_height: 9468930,
      burn_block_height: 975554,
      tx_result: {
        hex: '0x070100000000000000000000000000001411',
        repr: '(ok u5137)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'initiate-withdrawal-request',
        function_signature:
          '(define-public (initiate-withdrawal-request (amount uint) (recipient (tuple (hashbytes (buff 32)) (version (buff 1)))) (max-fee uint)))',
        function_args: [
          {
            hex: '0x01000000000000000000000000000028d1',
            repr: 'u10449',
            name: 'amount',
            type: 'uint',
          },
          {
            hex: '0x0c000000020968617368627974657302000000144902d93a2b21adc36225c6479aa0555a9e35bf9f0776657273696f6e020000000101',
            repr: '(tuple (hashbytes 0x4902d93a2b21adc36225c6479aa0555a9e35bf9f) (version 0x01))',
            name: 'recipient',
            type: '(tuple (hashbytes (buff 32)) (version (buff 1)))',
          },
          {
            hex: '0x010000000000000000000000000000066e',
            repr: 'u1646',
            name: 'max-fee',
            type: 'uint',
          },
        ],
      },
      post_condition_mode: 'deny',
      post_conditions: [
        {
          principal: {
            type_id: 'principal_standard',
            address: 'SP183Z0FZB67F4MX82PNXG2BK9KPESRA51ZDF196J',
          },
          condition_code: 'sent_equal_to',
          amount: '12095',
          type: 'fungible',
          asset: {
            asset_name: 'sbtc-token',
            contract_address: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4',
            contract_name: 'sbtc-token',
          },
        },
      ],
      events: [
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          tx_id: '0x13aada287839fe499f4c3843268f7534343f02d06f061be5af585981d1e7681f',
          asset: {
            asset_event_type: 'burn',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token',
            sender: 'SP183Z0FZB67F4MX82PNXG2BK9KPESRA51ZDF196J',
            recipient: '',
            amount: '12095',
          },
        },
        {
          event_index: 1,
          event_type: 'fungible_token_asset',
          tx_id: '0x13aada287839fe499f4c3843268f7534343f02d06f061be5af585981d1e7681f',
          asset: {
            asset_event_type: 'mint',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token-locked',
            sender: '',
            recipient: 'SP183Z0FZB67F4MX82PNXG2BK9KPESRA51ZDF196J',
            amount: '12095',
          },
        },
        {
          event_index: 2,
          event_type: 'smart_contract_log',
          tx_id: '0x13aada287839fe499f4c3843268f7534343f02d06f061be5af585981d1e7681f',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c0000000706616d6f756e7401000000000000000000000000000028d10c626c6f636b2d68656967687401000000000000000000000000000ee2c2076d61782d666565010000000000000000000000000000066e09726563697069656e740c000000020968617368627974657302000000144902d93a2b21adc36225c6479aa0555a9e35bf9f0776657273696f6e0200000001010a726571756573742d696401000000000000000000000000000014110673656e6465720516503f81ff598ef253a815abd809734cecece1450f05746f7069630d000000117769746864726177616c2d637265617465',
              repr: '(tuple (amount u10449) (block-height u975554) (max-fee u1646) (recipient (tuple (hashbytes 0x4902d93a2b21adc36225c6479aa0555a9e35bf9f) (version 0x01))) (request-id u5137) (sender \'SP183Z0FZB67F4MX82PNXG2BK9KPESRA51ZDF196J) (topic "withdrawal-create"))',
            },
          },
        },
      ],
      event_count: 3,
      vm_error: null,
    },
    requestRawTx:
      '0x00000000010400503f81ff598ef253a815abd809734cecece1450f000000000000000b0000000000000bb800015027ce46499d0369a2bdc52a15dc1331cba0427ea810417c47df48d2dccce7d61898e035f4c789d4545635aa92892bf4a17091d193d7df2c3e567816821793e6030200000001010216503f81ff598ef253a815abd809734cecece1450f14f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0a736274632d746f6b656e0a736274632d746f6b656e010000000000002f3f0214f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0f736274632d7769746864726177616c1b696e6974696174652d7769746864726177616c2d726571756573740000000301000000000000000000000000000028d10c000000020968617368627974657302000000144902d93a2b21adc36225c6479aa0555a9e35bf9f0776657273696f6e020000000101010000000000000000000000000000066e',
    getWithdrawalRequest:
      '0x0a0c0000000606616d6f756e7401000000000000000000000000000028d10c626c6f636b2d68656967687401000000000000000000000000000ee2c2076d61782d666565010000000000000000000000000000066e09726563697069656e740c000000020968617368627974657302000000144902d93a2b21adc36225c6479aa0555a9e35bf9f0776657273696f6e0200000001010673656e6465720516503f81ff598ef253a815abd809734cecece1450f067374617475730a03',
    getSweepData:
      '0x0a0c000000030f73776565702d6275726e2d68617368020000002000000000000000000000bf4136548940516fd4709ec366105d55c06a3249f51e1173776565702d6275726e2d68656967687401000000000000000000000000000ee2cc0a73776565702d747869640200000020bdfee68285019235389c350de07167dbaf3331f02f6a0dcdb5a9ffce0fa0b00d',
    emily: {
      requestId: 5137,
      stacksBlockHash: '4b8531ba9c9ca448fb064dd75ae939256e0e7ee65cb254f1a45ebb3e38250748',
      stacksBlockHeight: 9468930,
      recipient: 'a9144902d93a2b21adc36225c6479aa0555a9e35bf9f87',
      sender: 'SP183Z0FZB67F4MX82PNXG2BK9KPESRA51ZDF196J',
      amount: 10449,
      lastUpdateHeight: 9469624,
      lastUpdateBlockHash: '28ea58278b93440e30c07a8b8dbd0ea1608a58456c7528e1e6981679d1bd312a',
      status: 'confirmed',
      statusMessage:
        'Included in block 28ea58278b93440e30c07a8b8dbd0ea1608a58456c7528e1e6981679d1bd312a',
      parameters: {
        maxFee: 1646,
      },
      fulfillment: {
        BitcoinTxid: 'bdfee68285019235389c350de07167dbaf3331f02f6a0dcdb5a9ffce0fa0b00d',
        BitcoinTxIndex: 2,
        StacksTxid: '348c5212f78efec9604b0799ebdad8a064ba8750c77b658eb8245f813d8cb62c',
        BitcoinBlockHash: '00000000000000000000bf4136548940516fd4709ec366105d55c06a3249f51e',
        BitcoinBlockHeight: 975564,
        BtcFee: 88,
      },
      expectedFulfillmentInfo: {
        bitcoinBlockHeight: 975561,
        bitcoinTxid: 'bdfee68285019235389c350de07167dbaf3331f02f6a0dcdb5a9ffce0fa0b00d',
      },
      txid: '13aada287839fe499f4c3843268f7534343f02d06f061be5af585981d1e7681f',
    },
    acceptTx: {
      tx_id: '0x348c5212f78efec9604b0799ebdad8a064ba8750c77b658eb8245f813d8cb62c',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SM37A2MMXMKEHTZ0N6N81TFF4XEA62J2ZR3NM7BW8',
      sponsored: false,
      nonce: 26505,
      fee_rate: '14346',
      block_height: 9469624,
      burn_block_height: 975565,
      tx_result: {
        hex: '0x0703',
        repr: '(ok true)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'accept-withdrawal-request',
        function_signature:
          '(define-public (accept-withdrawal-request (request-id uint) (bitcoin-txid (buff 32)) (signer-bitmap uint) (output-index uint) (fee uint) (burn-hash (buff 32)) (burn-height uint) (sweep-txid (buff 32))))',
        function_args: [
          {
            hex: '0x0100000000000000000000000000001411',
            repr: 'u5137',
            name: 'request-id',
            type: 'uint',
          },
          {
            hex: '0x0200000020bdfee68285019235389c350de07167dbaf3331f02f6a0dcdb5a9ffce0fa0b00d',
            repr: '0xbdfee68285019235389c350de07167dbaf3331f02f6a0dcdb5a9ffce0fa0b00d',
            name: 'bitcoin-txid',
            type: '(buff 32)',
          },
          {
            hex: '0x0100000000000000000000000000000000',
            repr: 'u0',
            name: 'signer-bitmap',
            type: 'uint',
          },
          {
            hex: '0x0100000000000000000000000000000002',
            repr: 'u2',
            name: 'output-index',
            type: 'uint',
          },
          {
            hex: '0x0100000000000000000000000000000058',
            repr: 'u88',
            name: 'fee',
            type: 'uint',
          },
          {
            hex: '0x020000002000000000000000000000bf4136548940516fd4709ec366105d55c06a3249f51e',
            repr: '0x00000000000000000000bf4136548940516fd4709ec366105d55c06a3249f51e',
            name: 'burn-hash',
            type: '(buff 32)',
          },
          {
            hex: '0x01000000000000000000000000000ee2cc',
            repr: 'u975564',
            name: 'burn-height',
            type: 'uint',
          },
          {
            hex: '0x0200000020bdfee68285019235389c350de07167dbaf3331f02f6a0dcdb5a9ffce0fa0b00d',
            repr: '0xbdfee68285019235389c350de07167dbaf3331f02f6a0dcdb5a9ffce0fa0b00d',
            name: 'sweep-txid',
            type: '(buff 32)',
          },
        ],
      },
      post_condition_mode: 'allow',
      post_conditions: [],
      events: [
        {
          event_index: 2,
          event_type: 'smart_contract_log',
          tx_id: '0x348c5212f78efec9604b0799ebdad8a064ba8750c77b658eb8245f813d8cb62c',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c000000090c626974636f696e2d747869640200000020bdfee68285019235389c350de07167dbaf3331f02f6a0dcdb5a9ffce0fa0b00d096275726e2d68617368020000002000000000000000000000bf4136548940516fd4709ec366105d55c06a3249f51e0b6275726e2d68656967687401000000000000000000000000000ee2cc0366656501000000000000000000000000000000580c6f75747075742d696e64657801000000000000000000000000000000020a726571756573742d696401000000000000000000000000000014110d7369676e65722d6269746d617001000000000000000000000000000000000a73776565702d747869640200000020bdfee68285019235389c350de07167dbaf3331f02f6a0dcdb5a9ffce0fa0b00d05746f7069630d000000117769746864726177616c2d616363657074',
              repr: '(tuple (bitcoin-txid 0xbdfee68285019235389c350de07167dbaf3331f02f6a0dcdb5a9ffce0fa0b00d) (burn-hash 0x00000000000000000000bf4136548940516fd4709ec366105d55c06a3249f51e) (burn-height u975564) (fee u88) (output-index u2) (request-id u5137) (signer-bitmap u0) (sweep-txid 0xbdfee68285019235389c350de07167dbaf3331f02f6a0dcdb5a9ffce0fa0b00d) (topic "withdrawal-accept"))',
            },
          },
        },
      ],
      event_count: 3,
      vm_error: null,
    },
    btcTx: {
      txid: 'bdfee68285019235389c350de07167dbaf3331f02f6a0dcdb5a9ffce0fa0b00d',
      weight: 5205,
      fee: 2611,
      vin: [
        {
          txid: 'b28d636da016c6a11ef93fae1a9bd5c02fbf8c6a9593481d64c5a0ef9521f14f',
          vout: 0,
        },
        {
          txid: '6ed5484239119680afd6253bea7f6a3fb36f167055a778a1df85df4237994801',
          vout: 1,
        },
        {
          txid: 'e07ecd58a50e0303bd12d4f9f934d03276b2c0ac773a899f42c60a56f8e96f03',
          vout: 1,
        },
        {
          txid: '9044c9a8b284c2c90147ef8f8d64e0f0df6526b9babfd959acc35550910c230f',
          vout: 0,
        },
        {
          txid: '7c4e8fadcb654567d0bf3d7a7396f5d35ff927b835215e2a78ccaf6acd5e9827',
          vout: 1,
        },
        {
          txid: 'b694343ffac75231e09f8e7db44711a5b6a192c7b3060618b74adeab32fcb352',
          vout: 1,
        },
        {
          txid: '67a7fe2f17c526c6a821eb0a68f6302057f485860e26bd1bb4003c1b9caaa463',
          vout: 1,
        },
        {
          txid: 'fe9b807ad8105c74c0b7dbdab45e9437dafe7e219de5f2889de8ef8134789b99',
          vout: 1,
        },
        {
          txid: '3c858fdb94d67b93172aadb5f83fdc8486b299d794422e086257b4fc89e9d8ab',
          vout: 1,
        },
        {
          txid: '87c2f8e4bec7dc8df9bd122773be9db6967ea949831be6648b6d054b8149b6cf',
          vout: 1,
        },
        {
          txid: '6e797f6e344448917caa4f8073004ce13f448d4041391f7640f82b078eafb1de',
          vout: 1,
        },
      ],
      vout: [
        {
          scriptpubkey: '51208056b53d7e41f8f80b4a2daa457b07f81b1b5f42036152c7d055cd9c7fcdf753',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1psptt20t7g8u0sz629k4y27c8lqd3kh6zqds4937s2hxecl7d7afsrhteyx',
          value: 247980209044,
        },
        {
          scriptpubkey: '6a06543301912800',
          scriptpubkey_type: 'op_return',
          value: 0,
        },
        {
          scriptpubkey: 'a9144902d93a2b21adc36225c6479aa0555a9e35bf9f87',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '38M4fU5VbuLWiXB24YQvfbbw56stJADdxr',
          value: 10449,
        },
      ],
      status: {
        confirmed: true,
        block_height: 975564,
        block_hash: '00000000000000000000bf4136548940516fd4709ec366105d55c06a3249f51e',
        block_time: 1794495279,
      },
    },
    btcTxHex:
      '0200000000010b4ff12195efa0c5641d4893956a8cbf2fc0d59b1aae3ff91ea1c616a06d638db20000000000000000000148993742df85dfa178a75570166fb33f6a7fea3b25d6af809611394248d56e010000000000000000036fe9f8560ac6429f893a77acc0b27632d034f9f9d412bd03030ea558cd7ee00100000000000000000f230c915055c3ac59d9bfbab92665dff0e0648d8fef4701c9c284b2a8c9449000000000000000000027985ecd6aafcc782a5e2135b827f95fd3f596737a3dbfd0674565cbad8f4e7c01000000000000000052b3fc32abde4ab7180606b3c792a1b6a51147b47d8e9fe03152c7fa3f3494b601000000000000000063a4aa9c1b3c00b41bbd260e8685f4572030f6680aeb21a8c626c5172ffea767010000000000000000999b783481efe89d88f2e59d217efeda37945eb4dadbb7c0745c10d87a809bfe010000000000000000abd8e989fcb45762082e4294d799b28684dc3ff8b5ad2a17937bd694db8f853c010000000000000000cfb649814b056d8b64e61b8349a97e96b69dbe732712bdf98ddcc7bee4f8c287010000000000000000deb1af8e072bf840761f3941408d443fe14c0073804faa7c914844346e7f796e0100000000000000000394b3c5bc390000002251208056b53d7e41f8f80b4a2daa457b07f81b1b5f42036152c7d055cd9c7fcdf7530000000000000000086a06543301912800d12800000000000017a9144902d93a2b21adc36225c6479aa0555a9e35bf9f870d4078bd409ca5717dd6a336abdba2aa3e2ecb9a3fd2f306e661d2d0077efcaf2c94677279ed6365afa0d7fd63a0eca1bb2596a3eeae0f16f7096cbc19558ef2f0f2400cf5c0c4179362e64257232bad943d3fb1ff7bbc19564c03abfad9bd9285ee69088f359c6a7b0d783d0a659bf465f8f90a170974621eba49a3d16e6a8bde269f409622dd0d246bb9308754a6957415aab3d50eee53d4206cf5133b558a03a58c69fac6f25b80949cfabd3929e1201a8fdbfa67656adb48383bac34b5a3085c7e99408349bdc2e077bcbfffe66930332a011ea0fc7b2c99cfb3166d57bc174d277d7fce3e53db5a6114eeccddf29cff409b892bf81cd9d3688af45f4dd4dd17386b7300400c9d115843719c3d336cf40afcb344781e0921a98c7ff967eb69500ccce337045dc1aafc0439cf41d38edf795a2967d1a84116da325b227322c37ecaf89336fe40b9a59524ca47c5ae54cdf9d4faee9b9e75a46ddb3e17131d06455846d9c26401a35e6c283d01b2570dcf044c5a7856073a209e97f55b07897bed734dec03ef7240516cf7d004d74d9322ccf3cdca7c3096adf4aeadd76dd4ce4c1a451a7c26db1119dc862a6f90d86d2e8243e41a890a1dfbcc4a62236d23324bdf9709d46b43e540762cceae46ed4185af4bb3c1193b97bb30efaf2be930e95c3fd81eeaf1565a074b473683ee57e4f119979be01eafb387cb285217b8bef8780b2531db264700060000fd780120045a602c7d83dfd1e7f576f611a26bbf7eae6d6b5f0a022b75684ffe4a8e5432ac201a39d16a6ffaa40fe404e64bc373c47bae126bd3d96dfcac5aa9c2137e089888ba201b6bf6534a8d3176db2e31063db3b1f35221c424306ee9a6b4ac50a46e7ee02eba202772abd64d7d82fa22700ebc9575d69548b699c04201f0d77e8e9602f58d8b64ba204505a302b1e030f1220b4e489c5ee28b855a4060e5a5e13fc739850b413a3121ba207a63f798bdcc5857c12c345f8373ba9167a93f431a3fe8be4fd74f9bbc0076fdba207b3e2369356df5edf768a5218f49c2a1ab871b46550d7ec8156bf2b378b38020ba20852d177ca592ee878b1272d6d166b694d5d419c07508246b07656c22f46b807bba20a3cc2583c4f46a92edace6621fa9dc592dd2fb674d7c5af6e59303f8648bd58eba20ac681c61c24074c42834d798b07d2ab5bdb6da7ea493f25cb3e691ceed663b33ba20ad20fef55bdcb8e14bf9c2de447b20ab36b3cd05261c7fc1e936f94d3514f7d2ba589c21c14a30b2e461b280c0b13a03799096ab1256589153fc4b9c8cead16dc0b64206970341767ae7c9b800391589c5df8b5d8d43dde87971b93c5307aa3fff41258aede8a63a9d0f669d05a0fe5b6befbdd9c6d53a421afc97056c7bf52a021d4af55eb7bf01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341ce02c16af1e206e271a6fdf6b8ddb66cdd4ec30c415f3b5426a09445bf35436d831c4e18f42821a75934343744b0d23c13c4fcc8b8fe0836784d2f914288b71401482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403412e07e32d36e76b09b43c71ab44294c0f4e0bf581dbaca7a56fc3aeb6e2cd92aa257233c625ee97889d5eb629392b820e756b4ef392e3dbe8f6cc0a23a53ba7b301421e000000000001388005165b7a93a3cab6931d77577328b8fbc1803449707f7520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c150929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac05b246457236d646784be76e41c51a0fd1e5ff69267bf8e5e5f54b3b749c5253003418ce4602df9e25c1ccac8f116eb7fc29e23b34f5136fadb646d3ccaae7b898dd250940d2fea50d27a435fbadb30ea2b271a83e8a2453ace80b7d95a46d558316901482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb3953614034107f451bb0bd856ef00a0e2dcc253b28cc090dc9bf02fe061946164c8fbb775ab7a1e45a4c4abb3188f0f0c9f006d3ed49f0c574dd58b611fed2beddba9fee21f01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403411f301b0f2dd935aea8af7852b3e385600fc5e90056b9be9e481bbf2d650acf0c192e2226d1e4cc1c5148ac6965e833d94e09157c2986fbf16dc427cff70b511b01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403412f5f300da9dec6ebba4905d929a21f61f6b1d28c3e0d0cff1bb7f528096b8225644acb34a43303acd479cb8b9168ae3044dd8faed8c1b8153090fb12e0f7e54101482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341172c082882ae4384aefcd448c75de2ebab806346052474568bda4ed531a4c7739eb2bf8ebfd699137037f1c50deefb422b74bc88cdb9adf56097da682ea3b93101482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341ccc51be4645089e8d4d6bcc51439a32cae332f2b65bb9b3be09b960d3130aac218acbcc7ff15e42e714d5187ad23d245e69491f65c4165407e7fad75de69340b01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403410881ca3be0365fca580cc0abb99f037dbb60e32923fee6da8ab04653c35185ed719b391e0db83f52e1bd2a1d7556782050e7a15b90b70fe1cfc76e03cdb21cae01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361400000000',
  },
  {
    id: 5130,
    outcome: 'accepted',
    kind: 'p2wpkh',
    direct: true,
    requestTxid: '4455a6f3d56100e0365583dad53a037ea2c8f80b16f5d19c949d7f66dbe86954',
    sender: 'SP2REA4BNX3F4A5ARQXEB4Y5HM3JN9KCC5MKKEZB7',
    amountSats: 18131,
    maxFeeSats: 1500,
    burnHeight: 975439,
    version: '04',
    hashbytes: '07679b5cd801699c5771c5b5354e9d8571eb47c5',
    scriptPubKey: '001407679b5cd801699c5771c5b5354e9d8571eb47c5',
    address: 'bc1qqanekhxcq95ec4m3ck6n2n5as4c7k3793werdn',
    payoutTxid: '670111dc00be59215a69c8dbf31ed7ad8e49d48c0a75c15de577b10450f8256d',
    payoutVout: 2,
    feeSats: 162,
    acceptTxid: 'b7142a6da88a257525c79ea3aeea03ed168b6bda828abf0edf31faef353bcc2f',
    requestTx: {
      tx_id: '0x4455a6f3d56100e0365583dad53a037ea2c8f80b16f5d19c949d7f66dbe86954',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SP2REA4BNX3F4A5ARQXEB4Y5HM3JN9KCC5MKKEZB7',
      sponsored: false,
      nonce: 42,
      fee_rate: '3000',
      block_height: 9462208,
      burn_block_height: 975439,
      tx_result: {
        hex: '0x07010000000000000000000000000000140a',
        repr: '(ok u5130)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'initiate-withdrawal-request',
        function_signature:
          '(define-public (initiate-withdrawal-request (amount uint) (recipient (tuple (hashbytes (buff 32)) (version (buff 1)))) (max-fee uint)))',
        function_args: [
          {
            hex: '0x01000000000000000000000000000046d3',
            repr: 'u18131',
            name: 'amount',
            type: 'uint',
          },
          {
            hex: '0x0c0000000209686173686279746573020000001407679b5cd801699c5771c5b5354e9d8571eb47c50776657273696f6e020000000104',
            repr: '(tuple (hashbytes 0x07679b5cd801699c5771c5b5354e9d8571eb47c5) (version 0x04))',
            name: 'recipient',
            type: '(tuple (hashbytes (buff 32)) (version (buff 1)))',
          },
          {
            hex: '0x01000000000000000000000000000005dc',
            repr: 'u1500',
            name: 'max-fee',
            type: 'uint',
          },
        ],
      },
      post_condition_mode: 'deny',
      post_conditions: [
        {
          principal: {
            type_id: 'principal_standard',
            address: 'SP2REA4BNX3F4A5ARQXEB4Y5HM3JN9KCC5MKKEZB7',
          },
          condition_code: 'sent_equal_to',
          amount: '19631',
          type: 'fungible',
          asset: {
            asset_name: 'sbtc-token',
            contract_address: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4',
            contract_name: 'sbtc-token',
          },
        },
      ],
      events: [
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          tx_id: '0x4455a6f3d56100e0365583dad53a037ea2c8f80b16f5d19c949d7f66dbe86954',
          asset: {
            asset_event_type: 'burn',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token',
            sender: 'SP2REA4BNX3F4A5ARQXEB4Y5HM3JN9KCC5MKKEZB7',
            recipient: '',
            amount: '19631',
          },
        },
        {
          event_index: 1,
          event_type: 'fungible_token_asset',
          tx_id: '0x4455a6f3d56100e0365583dad53a037ea2c8f80b16f5d19c949d7f66dbe86954',
          asset: {
            asset_event_type: 'mint',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token-locked',
            sender: '',
            recipient: 'SP2REA4BNX3F4A5ARQXEB4Y5HM3JN9KCC5MKKEZB7',
            amount: '19631',
          },
        },
        {
          event_index: 2,
          event_type: 'smart_contract_log',
          tx_id: '0x4455a6f3d56100e0365583dad53a037ea2c8f80b16f5d19c949d7f66dbe86954',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c0000000706616d6f756e7401000000000000000000000000000046d30c626c6f636b2d68656967687401000000000000000000000000000ee24f076d61782d66656501000000000000000000000000000005dc09726563697069656e740c0000000209686173686279746573020000001407679b5cd801699c5771c5b5354e9d8571eb47c50776657273696f6e0200000001040a726571756573742d6964010000000000000000000000000000140a0673656e6465720516b0e51175e8de451558bf5cb278b1a0e554cd8c2d05746f7069630d000000117769746864726177616c2d637265617465',
              repr: '(tuple (amount u18131) (block-height u975439) (max-fee u1500) (recipient (tuple (hashbytes 0x07679b5cd801699c5771c5b5354e9d8571eb47c5) (version 0x04))) (request-id u5130) (sender \'SP2REA4BNX3F4A5ARQXEB4Y5HM3JN9KCC5MKKEZB7) (topic "withdrawal-create"))',
            },
          },
        },
      ],
      event_count: 3,
      vm_error: null,
    },
    requestRawTx:
      '0x00000000010400b0e51175e8de451558bf5cb278b1a0e554cd8c2d000000000000002a0000000000000bb800019a18407496f9aa2f26396e8366228dadbf055e77ec679e586a3929a70b56c2c07671a7c6170e6a1a903c36327f067d35c42ecc0bc758ba5490329306e6332656030200000001010216b0e51175e8de451558bf5cb278b1a0e554cd8c2d14f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0a736274632d746f6b656e0a736274632d746f6b656e010000000000004caf0214f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0f736274632d7769746864726177616c1b696e6974696174652d7769746864726177616c2d726571756573740000000301000000000000000000000000000046d30c0000000209686173686279746573020000001407679b5cd801699c5771c5b5354e9d8571eb47c50776657273696f6e02000000010401000000000000000000000000000005dc',
    getWithdrawalRequest:
      '0x0a0c0000000606616d6f756e7401000000000000000000000000000046d30c626c6f636b2d68656967687401000000000000000000000000000ee24f076d61782d66656501000000000000000000000000000005dc09726563697069656e740c0000000209686173686279746573020000001407679b5cd801699c5771c5b5354e9d8571eb47c50776657273696f6e0200000001040673656e6465720516b0e51175e8de451558bf5cb278b1a0e554cd8c2d067374617475730a03',
    getSweepData:
      '0x0a0c000000030f73776565702d6275726e2d68617368020000002000000000000000000001584846d4cf038745265c23557b119b5bcf334b8c73361173776565702d6275726e2d68656967687401000000000000000000000000000ee2590a73776565702d747869640200000020670111dc00be59215a69c8dbf31ed7ad8e49d48c0a75c15de577b10450f8256d',
    emily: {
      requestId: 5130,
      stacksBlockHash: '0c293c4b09d2a9b236e064c3e3cdd0aefbe45b4d1282e37d60f96ef99541f9ce',
      stacksBlockHeight: 9462208,
      recipient: '001407679b5cd801699c5771c5b5354e9d8571eb47c5',
      sender: 'SP2REA4BNX3F4A5ARQXEB4Y5HM3JN9KCC5MKKEZB7',
      amount: 18131,
      lastUpdateHeight: 9462641,
      lastUpdateBlockHash: '1cca6ffddf52ead755e9c8ef654e1195781314b0866e36047a8deb34d29f45dc',
      status: 'confirmed',
      statusMessage:
        'Included in block 1cca6ffddf52ead755e9c8ef654e1195781314b0866e36047a8deb34d29f45dc',
      parameters: {
        maxFee: 1500,
      },
      fulfillment: {
        BitcoinTxid: '670111dc00be59215a69c8dbf31ed7ad8e49d48c0a75c15de577b10450f8256d',
        BitcoinTxIndex: 2,
        StacksTxid: 'b7142a6da88a257525c79ea3aeea03ed168b6bda828abf0edf31faef353bcc2f',
        BitcoinBlockHash: '00000000000000000001584846d4cf038745265c23557b119b5bcf334b8c7336',
        BitcoinBlockHeight: 975449,
        BtcFee: 162,
      },
      expectedFulfillmentInfo: {
        bitcoinBlockHeight: 975446,
        bitcoinTxid: '670111dc00be59215a69c8dbf31ed7ad8e49d48c0a75c15de577b10450f8256d',
      },
      txid: '4455a6f3d56100e0365583dad53a037ea2c8f80b16f5d19c949d7f66dbe86954',
    },
    acceptTx: {
      tx_id: '0xb7142a6da88a257525c79ea3aeea03ed168b6bda828abf0edf31faef353bcc2f',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SM37A2MMXMKEHTZ0N6N81TFF4XEA62J2ZR3NM7BW8',
      sponsored: false,
      nonce: 25818,
      fee_rate: '1011',
      block_height: 9462641,
      burn_block_height: 975449,
      tx_result: {
        hex: '0x0703',
        repr: '(ok true)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'accept-withdrawal-request',
        function_signature:
          '(define-public (accept-withdrawal-request (request-id uint) (bitcoin-txid (buff 32)) (signer-bitmap uint) (output-index uint) (fee uint) (burn-hash (buff 32)) (burn-height uint) (sweep-txid (buff 32))))',
        function_args: [
          {
            hex: '0x010000000000000000000000000000140a',
            repr: 'u5130',
            name: 'request-id',
            type: 'uint',
          },
          {
            hex: '0x0200000020670111dc00be59215a69c8dbf31ed7ad8e49d48c0a75c15de577b10450f8256d',
            repr: '0x670111dc00be59215a69c8dbf31ed7ad8e49d48c0a75c15de577b10450f8256d',
            name: 'bitcoin-txid',
            type: '(buff 32)',
          },
          {
            hex: '0x0100000000000000000000000000000000',
            repr: 'u0',
            name: 'signer-bitmap',
            type: 'uint',
          },
          {
            hex: '0x0100000000000000000000000000000002',
            repr: 'u2',
            name: 'output-index',
            type: 'uint',
          },
          {
            hex: '0x01000000000000000000000000000000a2',
            repr: 'u162',
            name: 'fee',
            type: 'uint',
          },
          {
            hex: '0x020000002000000000000000000001584846d4cf038745265c23557b119b5bcf334b8c7336',
            repr: '0x00000000000000000001584846d4cf038745265c23557b119b5bcf334b8c7336',
            name: 'burn-hash',
            type: '(buff 32)',
          },
          {
            hex: '0x01000000000000000000000000000ee259',
            repr: 'u975449',
            name: 'burn-height',
            type: 'uint',
          },
          {
            hex: '0x0200000020670111dc00be59215a69c8dbf31ed7ad8e49d48c0a75c15de577b10450f8256d',
            repr: '0x670111dc00be59215a69c8dbf31ed7ad8e49d48c0a75c15de577b10450f8256d',
            name: 'sweep-txid',
            type: '(buff 32)',
          },
        ],
      },
      post_condition_mode: 'allow',
      post_conditions: [],
      events: [
        {
          event_index: 2,
          event_type: 'smart_contract_log',
          tx_id: '0xb7142a6da88a257525c79ea3aeea03ed168b6bda828abf0edf31faef353bcc2f',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c000000090c626974636f696e2d747869640200000020670111dc00be59215a69c8dbf31ed7ad8e49d48c0a75c15de577b10450f8256d096275726e2d68617368020000002000000000000000000001584846d4cf038745265c23557b119b5bcf334b8c73360b6275726e2d68656967687401000000000000000000000000000ee2590366656501000000000000000000000000000000a20c6f75747075742d696e64657801000000000000000000000000000000020a726571756573742d6964010000000000000000000000000000140a0d7369676e65722d6269746d617001000000000000000000000000000000000a73776565702d747869640200000020670111dc00be59215a69c8dbf31ed7ad8e49d48c0a75c15de577b10450f8256d05746f7069630d000000117769746864726177616c2d616363657074',
              repr: '(tuple (bitcoin-txid 0x670111dc00be59215a69c8dbf31ed7ad8e49d48c0a75c15de577b10450f8256d) (burn-hash 0x00000000000000000001584846d4cf038745265c23557b119b5bcf334b8c7336) (burn-height u975449) (fee u162) (output-index u2) (request-id u5130) (signer-bitmap u0) (sweep-txid 0x670111dc00be59215a69c8dbf31ed7ad8e49d48c0a75c15de577b10450f8256d) (topic "withdrawal-accept"))',
            },
          },
        },
      ],
      event_count: 3,
      vm_error: null,
    },
    btcTx: {
      txid: '670111dc00be59215a69c8dbf31ed7ad8e49d48c0a75c15de577b10450f8256d',
      weight: 2247,
      fee: 1128,
      vin: [
        {
          txid: '5082d12dd6c83902f6e4b81e5c48a74a972b2389a18f476408d9b6572872eacd',
          vout: 0,
        },
        {
          txid: '02f3dc51fb6fbbc57fafa440275ef08fddb5fa7a44df1290d1436032635f3646',
          vout: 1,
        },
        {
          txid: 'e013c1f0b3d0f80f12d09b0ec00b65afe054f8fe83b4af9533b5a4484b928cf7',
          vout: 1,
        },
      ],
      vout: [
        {
          scriptpubkey: '51208056b53d7e41f8f80b4a2daa457b07f81b1b5f42036152c7d055cd9c7fcdf753',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1psptt20t7g8u0sz629k4y27c8lqd3kh6zqds4937s2hxecl7d7afsrhteyx',
          value: 247883647007,
        },
        {
          scriptpubkey: '6a065433018a2800',
          scriptpubkey_type: 'op_return',
          value: 0,
        },
        {
          scriptpubkey: '001407679b5cd801699c5771c5b5354e9d8571eb47c5',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qqanekhxcq95ec4m3ck6n2n5as4c7k3793werdn',
          value: 18131,
        },
      ],
      status: {
        confirmed: true,
        block_height: 975449,
        block_hash: '00000000000000000001584846d4cf038745265c23557b119b5bcf334b8c7336',
        block_time: 1794410523,
      },
    },
    btcTxHex:
      '02000000000103cdea722857b6d90864478fa189232b974aa7485c1eb8e4f60239c8d62dd1825000000000000000000046365f63326043d19012df447afab5dd8ff05e2740a4af7fc5bb6ffb51dcf302010000000000000000f78c924b48a4b53395afb483fef854e0af650bc00e9bd0120ff8d0b3f0c113e0010000000000000000031f4804b7390000002251208056b53d7e41f8f80b4a2daa457b07f81b1b5f42036152c7d055cd9c7fcdf7530000000000000000086a065433018a2800d34600000000000016001407679b5cd801699c5771c5b5354e9d8571eb47c50d40ff28a1c0a69d2455210db8f07cfc0dddf0c4b87ec660a6d44015ab061ebe07211e7df57a46cf11469941b821ec86219c920e3ebe20454186b4697f5cca34699e4023d34db9865b614625e180a36761c54b0fef2fbf37d795793baba34ace93adb0215d1573f790be7981a6b4fcfe9686ffd4450e3176536d47500d8f4322538b5e004093acdc5873897bdd3b5b447b6ad82d4742efc541013f17265cf55302feaa1c8eb472b8294e277a08adc1962b9b3e78f6f7e44a4c24dd9774730bda25c9b345e10040f734afdba2b5f1fcf7a4d72fa08f7cdbcfe4c5bf30f9a1fcad74fe1819e4376a85e8f074861212ade518643eca69598b4513391a8aa8d408a7f7f698f8dcc84140d88eac6db5ecd657b27ffde3c615b1d2b29de9df69961a2778071bda16357e7a649ae7b91c0046165c15ea69c0261a367f9f43c2797993b4404b1efcc71dfe734029e79fb3777078a02f9183cb0663af6e17196ee6e07f4f5cf37605cb00bfe637566e753eb25f5ecd502c8d06b92e620554ef0b0327d75ce4dc4431bfb9537efa40027ee6ef364f835281eb47dbd03d6bc73daca1b7e256a0b86fd24eb2027c2005e01201a91dda8ad99a70a43fc0b90be9b9af7700e2cf5802884619d050fe601f40a175f7d5728a98744d30ad5a58cc91f02d6db43d8568a7b9fe70dafb8ff852444fd5aefdf0144e964bc62a462dcb67da4e3229e3c56846f80d45ad8ff6320d3e00fd780120045a602c7d83dfd1e7f576f611a26bbf7eae6d6b5f0a022b75684ffe4a8e5432ac201a39d16a6ffaa40fe404e64bc373c47bae126bd3d96dfcac5aa9c2137e089888ba201b6bf6534a8d3176db2e31063db3b1f35221c424306ee9a6b4ac50a46e7ee02eba202772abd64d7d82fa22700ebc9575d69548b699c04201f0d77e8e9602f58d8b64ba204505a302b1e030f1220b4e489c5ee28b855a4060e5a5e13fc739850b413a3121ba207a63f798bdcc5857c12c345f8373ba9167a93f431a3fe8be4fd74f9bbc0076fdba207b3e2369356df5edf768a5218f49c2a1ab871b46550d7ec8156bf2b378b38020ba20852d177ca592ee878b1272d6d166b694d5d419c07508246b07656c22f46b807bba20a3cc2583c4f46a92edace6621fa9dc592dd2fb674d7c5af6e59303f8648bd58eba20ac681c61c24074c42834d798b07d2ab5bdb6da7ea493f25cb3e691ceed663b33ba20ad20fef55bdcb8e14bf9c2de447b20ab36b3cd05261c7fc1e936f94d3514f7d2ba589c21c14a30b2e461b280c0b13a03799096ab1256589153fc4b9c8cead16dc0b64206970341f56609fe03a7e04737ec5f87576ec4862e59b574f678994ca3a2eca6600aecef6fae21c60c647f978cfc16ae809b56cce7cdd711fbe05417b50523a9d1a60e2601482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341e4c7c4c11e3dfb0424d5db9396ef056738e5a62d35b58b768c33ea66191a94a495c1a47fb1d11ca9b39e9cdc07902a916941ced764ab381d271f2f026f5cee6401482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361400000000',
  },
  {
    id: 5128,
    outcome: 'accepted',
    kind: 'p2wpkh',
    direct: true,
    requestTxid: 'bd27b9bb6bd24f0ab3bf60927a970fa1300aa3156bbe3ff444ef563b8e9d9ec1',
    sender: 'SP2CWVQJQR6A639P3PS1VRKS68AFKSQA9NDWJMFG',
    amountSats: 17507,
    maxFeeSats: 1646,
    burnHeight: 975424,
    version: '04',
    hashbytes: 'f1340d1f631c530956159b48396dd6a797e1d29e',
    scriptPubKey: '0014f1340d1f631c530956159b48396dd6a797e1d29e',
    address: 'bc1q7y6q68mrr3fsj4s4ndyrjmwk57t7r557tx5vrn',
    payoutTxid: '67b2cb5fed63c0e68bd56cb3b37d1cfdc0d135ebfce3b037602d39a594dfb5bf',
    payoutVout: 2,
    feeSats: 42,
    acceptTxid: '42f376cfd258d33ebf334059de0337d822c7163003bbc17bef2f558735cd28a0',
    requestTx: {
      tx_id: '0xbd27b9bb6bd24f0ab3bf60927a970fa1300aa3156bbe3ff444ef563b8e9d9ec1',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SP2CWVQJQR6A639P3PS1VRKS68AFKSQA9NDWJMFG',
      sponsored: false,
      nonce: 32,
      fee_rate: '3000',
      block_height: 9460983,
      burn_block_height: 975424,
      tx_result: {
        hex: '0x070100000000000000000000000000001408',
        repr: '(ok u5128)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'initiate-withdrawal-request',
        function_signature:
          '(define-public (initiate-withdrawal-request (amount uint) (recipient (tuple (hashbytes (buff 32)) (version (buff 1)))) (max-fee uint)))',
        function_args: [
          {
            hex: '0x0100000000000000000000000000004463',
            repr: 'u17507',
            name: 'amount',
            type: 'uint',
          },
          {
            hex: '0x0c00000002096861736862797465730200000014f1340d1f631c530956159b48396dd6a797e1d29e0776657273696f6e020000000104',
            repr: '(tuple (hashbytes 0xf1340d1f631c530956159b48396dd6a797e1d29e) (version 0x04))',
            name: 'recipient',
            type: '(tuple (hashbytes (buff 32)) (version (buff 1)))',
          },
          {
            hex: '0x010000000000000000000000000000066e',
            repr: 'u1646',
            name: 'max-fee',
            type: 'uint',
          },
        ],
      },
      post_condition_mode: 'deny',
      post_conditions: [
        {
          principal: {
            type_id: 'principal_standard',
            address: 'SP2CWVQJQR6A639P3PS1VRKS68AFKSQA9NDWJMFG',
          },
          condition_code: 'sent_equal_to',
          amount: '19153',
          type: 'fungible',
          asset: {
            asset_name: 'sbtc-token',
            contract_address: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4',
            contract_name: 'sbtc-token',
          },
        },
      ],
      events: [
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          tx_id: '0xbd27b9bb6bd24f0ab3bf60927a970fa1300aa3156bbe3ff444ef563b8e9d9ec1',
          asset: {
            asset_event_type: 'burn',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token',
            sender: 'SP2CWVQJQR6A639P3PS1VRKS68AFKSQA9NDWJMFG',
            recipient: '',
            amount: '19153',
          },
        },
        {
          event_index: 1,
          event_type: 'fungible_token_asset',
          tx_id: '0xbd27b9bb6bd24f0ab3bf60927a970fa1300aa3156bbe3ff444ef563b8e9d9ec1',
          asset: {
            asset_event_type: 'mint',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token-locked',
            sender: '',
            recipient: 'SP2CWVQJQR6A639P3PS1VRKS68AFKSQA9NDWJMFG',
            amount: '19153',
          },
        },
        {
          event_index: 2,
          event_type: 'smart_contract_log',
          tx_id: '0xbd27b9bb6bd24f0ab3bf60927a970fa1300aa3156bbe3ff444ef563b8e9d9ec1',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c0000000706616d6f756e7401000000000000000000000000000044630c626c6f636b2d68656967687401000000000000000000000000000ee240076d61782d666565010000000000000000000000000000066e09726563697069656e740c00000002096861736862797465730200000014f1340d1f631c530956159b48396dd6a797e1d29e0776657273696f6e0200000001040a726571756573742d696401000000000000000000000000000014080673656e646572051604ce6ef2be0ca30d361db21de2793214f9e6ea4d05746f7069630d000000117769746864726177616c2d637265617465',
              repr: '(tuple (amount u17507) (block-height u975424) (max-fee u1646) (recipient (tuple (hashbytes 0xf1340d1f631c530956159b48396dd6a797e1d29e) (version 0x04))) (request-id u5128) (sender \'SP2CWVQJQR6A639P3PS1VRKS68AFKSQA9NDWJMFG) (topic "withdrawal-create"))',
            },
          },
        },
      ],
      event_count: 3,
      vm_error: null,
    },
    requestRawTx:
      '0x0000000001040004ce6ef2be0ca30d361db21de2793214f9e6ea4d00000000000000200000000000000bb80001aa8b7bbeb0db0dc59c0491e660e1de5c055a3fa72a363cdafeab6812355e04216a92a9c50be100f6c5d97a4a9649b5f8384b2d8d1713fcaaad6a670cc6aeed1003020000000101021604ce6ef2be0ca30d361db21de2793214f9e6ea4d14f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0a736274632d746f6b656e0a736274632d746f6b656e010000000000004ad10214f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0f736274632d7769746864726177616c1b696e6974696174652d7769746864726177616c2d726571756573740000000301000000000000000000000000000044630c00000002096861736862797465730200000014f1340d1f631c530956159b48396dd6a797e1d29e0776657273696f6e020000000104010000000000000000000000000000066e',
    getWithdrawalRequest:
      '0x0a0c0000000606616d6f756e7401000000000000000000000000000044630c626c6f636b2d68656967687401000000000000000000000000000ee240076d61782d666565010000000000000000000000000000066e09726563697069656e740c00000002096861736862797465730200000014f1340d1f631c530956159b48396dd6a797e1d29e0776657273696f6e0200000001040673656e646572051604ce6ef2be0ca30d361db21de2793214f9e6ea4d067374617475730a03',
    getSweepData:
      '0x0a0c000000030f73776565702d6275726e2d686173680200000020000000000000000000003c28c5f0af17c96cc17724dfb79002a601e2697377b71173776565702d6275726e2d68656967687401000000000000000000000000000ee2480a73776565702d74786964020000002067b2cb5fed63c0e68bd56cb3b37d1cfdc0d135ebfce3b037602d39a594dfb5bf',
    emily: {
      requestId: 5128,
      stacksBlockHash: '549042725eb6ec36fa8eb213ac32121c4c333fdb0bfafdd19514316d25e783e3',
      stacksBlockHeight: 9460983,
      recipient: '0014f1340d1f631c530956159b48396dd6a797e1d29e',
      sender: 'SP2CWVQJQR6A639P3PS1VRKS68AFKSQA9NDWJMFG',
      amount: 17507,
      lastUpdateHeight: 9461608,
      lastUpdateBlockHash: '12b7d2cfc9ccb7bdbe34737bb41eae14a41492d25b6db111f4445c436923752f',
      status: 'confirmed',
      statusMessage:
        'Included in block 12b7d2cfc9ccb7bdbe34737bb41eae14a41492d25b6db111f4445c436923752f',
      parameters: {
        maxFee: 1646,
      },
      fulfillment: {
        BitcoinTxid: '67b2cb5fed63c0e68bd56cb3b37d1cfdc0d135ebfce3b037602d39a594dfb5bf',
        BitcoinTxIndex: 2,
        StacksTxid: '42f376cfd258d33ebf334059de0337d822c7163003bbc17bef2f558735cd28a0',
        BitcoinBlockHash: '000000000000000000003c28c5f0af17c96cc17724dfb79002a601e2697377b7',
        BitcoinBlockHeight: 975432,
        BtcFee: 42,
      },
      expectedFulfillmentInfo: {
        bitcoinBlockHeight: 975431,
        bitcoinTxid: '67b2cb5fed63c0e68bd56cb3b37d1cfdc0d135ebfce3b037602d39a594dfb5bf',
      },
      txid: 'bd27b9bb6bd24f0ab3bf60927a970fa1300aa3156bbe3ff444ef563b8e9d9ec1',
    },
    acceptTx: {
      tx_id: '0x42f376cfd258d33ebf334059de0337d822c7163003bbc17bef2f558735cd28a0',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SM37A2MMXMKEHTZ0N6N81TFF4XEA62J2ZR3NM7BW8',
      sponsored: false,
      nonce: 25726,
      fee_rate: '2853',
      block_height: 9461608,
      burn_block_height: 975432,
      tx_result: {
        hex: '0x0703',
        repr: '(ok true)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'accept-withdrawal-request',
        function_signature:
          '(define-public (accept-withdrawal-request (request-id uint) (bitcoin-txid (buff 32)) (signer-bitmap uint) (output-index uint) (fee uint) (burn-hash (buff 32)) (burn-height uint) (sweep-txid (buff 32))))',
        function_args: [
          {
            hex: '0x0100000000000000000000000000001408',
            repr: 'u5128',
            name: 'request-id',
            type: 'uint',
          },
          {
            hex: '0x020000002067b2cb5fed63c0e68bd56cb3b37d1cfdc0d135ebfce3b037602d39a594dfb5bf',
            repr: '0x67b2cb5fed63c0e68bd56cb3b37d1cfdc0d135ebfce3b037602d39a594dfb5bf',
            name: 'bitcoin-txid',
            type: '(buff 32)',
          },
          {
            hex: '0x0100000000000000000000000000000000',
            repr: 'u0',
            name: 'signer-bitmap',
            type: 'uint',
          },
          {
            hex: '0x0100000000000000000000000000000002',
            repr: 'u2',
            name: 'output-index',
            type: 'uint',
          },
          {
            hex: '0x010000000000000000000000000000002a',
            repr: 'u42',
            name: 'fee',
            type: 'uint',
          },
          {
            hex: '0x0200000020000000000000000000003c28c5f0af17c96cc17724dfb79002a601e2697377b7',
            repr: '0x000000000000000000003c28c5f0af17c96cc17724dfb79002a601e2697377b7',
            name: 'burn-hash',
            type: '(buff 32)',
          },
          {
            hex: '0x01000000000000000000000000000ee248',
            repr: 'u975432',
            name: 'burn-height',
            type: 'uint',
          },
          {
            hex: '0x020000002067b2cb5fed63c0e68bd56cb3b37d1cfdc0d135ebfce3b037602d39a594dfb5bf',
            repr: '0x67b2cb5fed63c0e68bd56cb3b37d1cfdc0d135ebfce3b037602d39a594dfb5bf',
            name: 'sweep-txid',
            type: '(buff 32)',
          },
        ],
      },
      post_condition_mode: 'allow',
      post_conditions: [],
      events: [
        {
          event_index: 2,
          event_type: 'smart_contract_log',
          tx_id: '0x42f376cfd258d33ebf334059de0337d822c7163003bbc17bef2f558735cd28a0',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c000000090c626974636f696e2d74786964020000002067b2cb5fed63c0e68bd56cb3b37d1cfdc0d135ebfce3b037602d39a594dfb5bf096275726e2d686173680200000020000000000000000000003c28c5f0af17c96cc17724dfb79002a601e2697377b70b6275726e2d68656967687401000000000000000000000000000ee24803666565010000000000000000000000000000002a0c6f75747075742d696e64657801000000000000000000000000000000020a726571756573742d696401000000000000000000000000000014080d7369676e65722d6269746d617001000000000000000000000000000000000a73776565702d74786964020000002067b2cb5fed63c0e68bd56cb3b37d1cfdc0d135ebfce3b037602d39a594dfb5bf05746f7069630d000000117769746864726177616c2d616363657074',
              repr: '(tuple (bitcoin-txid 0x67b2cb5fed63c0e68bd56cb3b37d1cfdc0d135ebfce3b037602d39a594dfb5bf) (burn-hash 0x000000000000000000003c28c5f0af17c96cc17724dfb79002a601e2697377b7) (burn-height u975432) (fee u42) (output-index u2) (request-id u5128) (signer-bitmap u0) (sweep-txid 0x67b2cb5fed63c0e68bd56cb3b37d1cfdc0d135ebfce3b037602d39a594dfb5bf) (topic "withdrawal-accept"))',
            },
          },
        },
      ],
      event_count: 3,
      vm_error: null,
    },
    btcTx: {
      txid: '67b2cb5fed63c0e68bd56cb3b37d1cfdc0d135ebfce3b037602d39a594dfb5bf',
      weight: 7427,
      fee: 2008,
      vin: [
        {
          txid: '38ab646af69b2ec3c3408305a4b49cfa90829a25febb7f6ee8c8342a5f1d8915',
          vout: 0,
        },
        {
          txid: '58e464250279f9b15de4d6d7cb4f6983c1232a223799bfe1b8ec4ecc9524ea02',
          vout: 1,
        },
        {
          txid: '23343ba9d36e5514cbe5b3189e11243a7ab1200594b803de1f18b6be0220c115',
          vout: 1,
        },
        {
          txid: 'cf48d81aefea78d4c7fadc1313080b87f38b3e3fa279d588cfe86d85f5f12549',
          vout: 1,
        },
        {
          txid: 'cee779e54ad76b016d0d497a9ba69654996a6faae69c10134a9c57c80249175b',
          vout: 1,
        },
        {
          txid: '3eaeef707a36b3d0bcf0f26a721c5ec61eeabfcab13575d73b59c4dd6d06826e',
          vout: 1,
        },
        {
          txid: '74dd7198aaf388b1d1ecd1f5e0d12e405644fd42c6d90289d51a4fd84913a47e',
          vout: 1,
        },
        {
          txid: '707469bf7170eac6d67a9b9edead68b79ce870c988ecb8a44b5526da50e60583',
          vout: 1,
        },
        {
          txid: '678e8deab345631f3669c418a424c9e9fa9d07cbc8996cfac9d2fa0aafff7a8b',
          vout: 1,
        },
        {
          txid: '76a288b8d561e6da6888a8d7ed42b5b02562437623eb72c92356ab572b31f6b0',
          vout: 1,
        },
        {
          txid: 'e69929794349085b277b1bdadc566af2acf783dfaff1e3c0de2d6998c3af37b2',
          vout: 1,
        },
        {
          txid: '512144b1c189870c130f7118874cdccb359b6d062d4d300aec693fbe1a94fcb3',
          vout: 1,
        },
        {
          txid: '5a3ceb3b0aea7647afc552687a318babdd223a8140a4fa8a7e69973d430ce3df',
          vout: 1,
        },
        {
          txid: 'afe4b5991d1eb20808995ecbe620e58337b25a6b59cc3ded0dc215ef8c0869e8',
          vout: 1,
        },
        {
          txid: 'a473b7bcc610493dfe905ad6ac8b5f69f9b6207f62ba5e293a48d97471741ff6',
          vout: 1,
        },
        {
          txid: 'f1de4178fb6c23a079df0f8ac870f74eea15a17b2e685e5cedd7f14f725522ff',
          vout: 1,
        },
        {
          txid: '6121425b663b603d0dbc4a56509c4255b4a841182a6a707fc5600edcff9fd0ff',
          vout: 1,
        },
      ],
      vout: [
        {
          scriptpubkey: '51208056b53d7e41f8f80b4a2daa457b07f81b1b5f42036152c7d055cd9c7fcdf753',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1psptt20t7g8u0sz629k4y27c8lqd3kh6zqds4937s2hxecl7d7afsrhteyx',
          value: 247875375497,
        },
        {
          scriptpubkey: '6a06543301882800',
          scriptpubkey_type: 'op_return',
          value: 0,
        },
        {
          scriptpubkey: '0014f1340d1f631c530956159b48396dd6a797e1d29e',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q7y6q68mrr3fsj4s4ndyrjmwk57t7r557tx5vrn',
          value: 17507,
        },
      ],
      status: {
        confirmed: true,
        block_height: 975432,
        block_hash: '000000000000000000003c28c5f0af17c96cc17724dfb79002a601e2697377b7',
        block_time: 1794397766,
      },
    },
    btcTxHex:
      '0200000000011115891d5f2a34c8e86e7fbbfe259a8290fa9cb4a4058340c3c32e9bf66a64ab3800000000000000000002ea2495cc4eecb8e1bf9937222a23c183694fcbd7d6e45db1f979022564e45801000000000000000015c12002beb6181fde03b8940520b17a3a24119e18b3e5cb14556ed3a93b34230100000000000000004925f1f5856de8cf88d579a23f3e8bf3870b081313dcfac7d478eaef1ad848cf0100000000000000005b174902c8579c4a13109ce6aa6f6a995496a69b7a490d6d016bd74ae579e7ce0100000000000000006e82066dddc4593bd77535b1cabfea1ec65e1c726af2f0bcd0b3367a70efae3e0100000000000000007ea41349d84f1ad58902d9c642fd4456402ed1e0f5d1ecd1b188f3aa9871dd740100000000000000008305e650da26554ba4b8ec88c970e89cb768adde9e9b7ad6c6ea7071bf6974700100000000000000008b7affaf0afad2c9fa6c99c8cb079dfae9c924a418c469361f6345b3ea8d8e67010000000000000000b0f6312b57ab5623c972eb2376436225b0b542edd7a88868dae661d5b888a276010000000000000000b237afc398692ddec0e3f1afdf83f7acf26a56dcda1b7b275b084943792999e6010000000000000000b3fc941abe3f69ec0a304d2d066d9b35cbdc4c8718710f130c8789c1b1442151010000000000000000dfe30c433d97697e8afaa440813a22ddab8b317a6852c5af4776ea0a3beb3c5a010000000000000000e869088cef15c20ded3dcc596b5ab23783e520e6cb5e990808b21e1d99b5e4af010000000000000000f61f747174d9483a295eba627f20b6f9695f8bacd65a90fe3d4910c6bcb773a4010000000000000000ff2255724ff1d7ed5c5e682e7ba115ea4ef770c88a0fdf79a0236cfb7841def1010000000000000000ffd09fffdc0e60c57f706a2a1841a8b455429c50564abc0d3d603b665b42216101000000000000000003891186b6390000002251208056b53d7e41f8f80b4a2daa457b07f81b1b5f42036152c7d055cd9c7fcdf7530000000000000000086a065433018828006344000000000000160014f1340d1f631c530956159b48396dd6a797e1d29e0d0040d7fe35fc3d55aaedad800385fdf14f58cda9581e6cfeb404496f60acda2bc6fb53b1072ba4b6f294955ef973e8b07b5fe6cce39e8e4feb066be9304249bde4b24066d380334ad65b9e1f3f157dffae9720a32645fd4af37632f6a9d45be90c9dae2bf76df40698ccee32d0bad0e4247b3cbb4d535ffbd01b624ea0fe90086e8e9640dd13555f375b4d56baa976ff46233c659e22cdc9960bb613594afa64c5da3e0e27b595d1e56ac99ae87b6abd79ce28c80b1e4751455e757afa82bf30d59683680040507da74177fc7376dc563fe206602329a1fd8c64685975470c177f89244ff027aaa155202fc6b9cedc4d41fc732f6c6cc4850216c5fb231999bf97ad43645ade40f17358fa326bce81969ba9469000df14fa125c83a667a011d3bf30b997b2d1dc1294b0706aa5118187fa176649df3bb6e7bfd88d0f4a79e32dba51e81bb23af0409111d48e827081388060af65d46eefe7a04752f65966e5363a624eb67caf600104b5dc1552a20c51affb6cb37d55fa886d360523cab402cf91a84d82b6961cd040a42d6f8116b7a625866f2066aaa2d457ff91bc0fa8a4a88b63d6aa8351bf01cf04a60daf48047b4ebdec6ff7d8a918c5dd6455a307fa828900551c2cc16ea550404a006062416b1631e8994e67d4f48c5f238b78c98fe623a28918dc854a7ec79f3adc0a08d30379f3abeea9bf3be42d9b82783bd034e9719533b36da92a8fea8d00fd780120045a602c7d83dfd1e7f576f611a26bbf7eae6d6b5f0a022b75684ffe4a8e5432ac201a39d16a6ffaa40fe404e64bc373c47bae126bd3d96dfcac5aa9c2137e089888ba201b6bf6534a8d3176db2e31063db3b1f35221c424306ee9a6b4ac50a46e7ee02eba202772abd64d7d82fa22700ebc9575d69548b699c04201f0d77e8e9602f58d8b64ba204505a302b1e030f1220b4e489c5ee28b855a4060e5a5e13fc739850b413a3121ba207a63f798bdcc5857c12c345f8373ba9167a93f431a3fe8be4fd74f9bbc0076fdba207b3e2369356df5edf768a5218f49c2a1ab871b46550d7ec8156bf2b378b38020ba20852d177ca592ee878b1272d6d166b694d5d419c07508246b07656c22f46b807bba20a3cc2583c4f46a92edace6621fa9dc592dd2fb674d7c5af6e59303f8648bd58eba20ac681c61c24074c42834d798b07d2ab5bdb6da7ea493f25cb3e691ceed663b33ba20ad20fef55bdcb8e14bf9c2de447b20ab36b3cd05261c7fc1e936f94d3514f7d2ba589c21c14a30b2e461b280c0b13a03799096ab1256589153fc4b9c8cead16dc0b6420697034166c7812bff278d2bfa1ced1dfa77e553756b6da2ef6874b829a0119cfaaeef389511f577361eb9764be45f8a0988d5ffd372ad00cba14cc29424a5db9d94a39701482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb3953614034150abdd833f0b3be5f342ad5d71e8d13eed2868a53ab8546d6886685d47c942a537a630aa609ee07e30c378108bc145dd5dfb854d3a3e265db592310427b5ec3001482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341c08b303ffeab6c18911f06668e9c07c8eb4e575403104fc9cc761d780a9a622d7cd4e8d3930e1bee0ba7f70b107987a283661f1237a9d21a2ee6fd01ab953bac01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403418548b8a16e0fd267f2b6e004138b1580f516cfbbc51fd1f597fdd223c820836ffd91c021d3fdbe2711aebdc11b88248a89f5ae2e42b4002b9e30eac90f3b29fd01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403418b70a167223879743aaba8a5a00028a77f7c4a5ff075e21581b65b5532cdbcd5dbc7d75f4b22a38931ad5e02e6bc77d6b103b0f723ecf028420f7c18b7f75c9801482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341c136489ca632a9f4834442a102e6c32048ed5779b36a2e04693ce0b4f1be0b423a6159693ad3631687e7f225e45e3a67a55b7e1184d1674a45f2d80edad09a8101482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341da7c2d6132c95255b85a4db9175fa5d5aa20743985d01aefd0b9c819513d8d26c2367df2e4c8e42e659359d4c3f365c96dbc5193dcedc84362883ab28ec9822601482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341f75a6e3ee49103dcb1c58eb448e4ab6106070c952bcb00aef70cf8ababca0a3836a25887d535da1d93a7c6d7bb6c5bd32d4d717224758de9fefa3c40a4decfc501482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341cba74586fce75ce0405eee8bb2bececa7a1a8ae5d411f6f31a2df1e559607ffea0769fa803f74ecc2faaebcf94df77e368e25435df17531d3e57a0a3f342701801482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403418492b7a48bcb0d60e7ca8cb062daec54e70aa1785b5b3ff3fb244f48c0e106db3914c1e73c081da355b88b9d902895dd0f16ed24ed8c2f308f3776a88b2e42ff01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341d4b1f9aee2264aa53f628bbf7563b0f34c7edbd6fa878a74de3ea2e8361b9db0b1193aa90b61b6c95b348b42c17cc259061a65cdcbba62403be0a56e2420fd1f01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb3953614034175c1854edd477cd013c1ba2c1e17898f03420b7fe7e0dc97653b5f9e0715ea05363d3667edcf6cba4623b94fc51a6a0f214d4536427e26132d0b9cc1856dd23f01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341d16015e01702d29256008917377cdb85f3956c081593d9f5fa720a70b8f8ad575bab83860785d1348fd9487c5a8342cab5979dc45863794d89ad8a1ae1b346eb01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403419c1bf345c6288afad0df4cf1503df4663e0a700ba2646aa189e14aca1b0eab1ab5b2147af377802980855f6dce45c4e82d5e27fe1dd8a341dbc257de1257d82b01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341344cb7647979a39c6db0ff60c603d4327c44ab912263f79d8b2d8f45859770075b87f922eb4048f825ee5c915df3655234c931ab5abb566a9ec894bce78bd83f01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb3953614034177aaae48ecddf07e05d0652f3dfa6b7e78e9e6e63d3ea9519548e899e4c8575cbc0e93920b8feed83162b7a0308f1780d783c3a34c31880cb5aa5fb415849b7a01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361400000000',
  },
  {
    id: 5132,
    outcome: 'accepted',
    kind: 'p2wpkh',
    direct: true,
    requestTxid: 'ef1b5a170a8cbd90088dbc2079240f82194ad1322f469a082a197a43568b0905',
    sender: 'SP222J2R3XF5B8Q888DXTA41FXQVHYPMV4JD2WQK',
    amountSats: 6959600,
    maxFeeSats: 8000,
    burnHeight: 975454,
    version: '04',
    hashbytes: 'e35d46afbf65d69cce3472f4bf9b888c37594300',
    scriptPubKey: '0014e35d46afbf65d69cce3472f4bf9b888c37594300',
    address: 'bc1qudw5dtalvhtfen35wt6tlxug3sm4jscqpm0uz4',
    payoutTxid: '632b7304cd9876028747084d770b5af2ae0190e2117f0270557e927247b7fd59',
    payoutVout: 2,
    feeSats: 151,
    acceptTxid: '4ec3784bbe5b130b15940f0bb67c56cff49b699f70d55c063d9f746a7ae3b279',
    requestTx: {
      tx_id: '0xef1b5a170a8cbd90088dbc2079240f82194ad1322f469a082a197a43568b0905',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SP222J2R3XF5B8Q888DXTA41FXQVHYPMV4JD2WQK',
      sponsored: false,
      nonce: 10,
      fee_rate: '3000',
      block_height: 9463222,
      burn_block_height: 975454,
      tx_result: {
        hex: '0x07010000000000000000000000000000140c',
        repr: '(ok u5132)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'initiate-withdrawal-request',
        function_signature:
          '(define-public (initiate-withdrawal-request (amount uint) (recipient (tuple (hashbytes (buff 32)) (version (buff 1)))) (max-fee uint)))',
        function_args: [
          {
            hex: '0x01000000000000000000000000006a31f0',
            repr: 'u6959600',
            name: 'amount',
            type: 'uint',
          },
          {
            hex: '0x0c00000002096861736862797465730200000014e35d46afbf65d69cce3472f4bf9b888c375943000776657273696f6e020000000104',
            repr: '(tuple (hashbytes 0xe35d46afbf65d69cce3472f4bf9b888c37594300) (version 0x04))',
            name: 'recipient',
            type: '(tuple (hashbytes (buff 32)) (version (buff 1)))',
          },
          {
            hex: '0x0100000000000000000000000000001f40',
            repr: 'u8000',
            name: 'max-fee',
            type: 'uint',
          },
        ],
      },
      post_condition_mode: 'deny',
      post_conditions: [
        {
          principal: {
            type_id: 'principal_standard',
            address: 'SP222J2R3XF5B8Q888DXTA41FXQVHYPMV4JD2WQK',
          },
          condition_code: 'sent_less_than_or_equal_to',
          amount: '6967600',
          type: 'fungible',
          asset: {
            asset_name: 'sbtc-token',
            contract_address: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4',
            contract_name: 'sbtc-token',
          },
        },
      ],
      events: [
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          tx_id: '0xef1b5a170a8cbd90088dbc2079240f82194ad1322f469a082a197a43568b0905',
          asset: {
            asset_event_type: 'burn',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token',
            sender: 'SP222J2R3XF5B8Q888DXTA41FXQVHYPMV4JD2WQK',
            recipient: '',
            amount: '6967600',
          },
        },
        {
          event_index: 1,
          event_type: 'fungible_token_asset',
          tx_id: '0xef1b5a170a8cbd90088dbc2079240f82194ad1322f469a082a197a43568b0905',
          asset: {
            asset_event_type: 'mint',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token-locked',
            sender: '',
            recipient: 'SP222J2R3XF5B8Q888DXTA41FXQVHYPMV4JD2WQK',
            amount: '6967600',
          },
        },
        {
          event_index: 2,
          event_type: 'smart_contract_log',
          tx_id: '0xef1b5a170a8cbd90088dbc2079240f82194ad1322f469a082a197a43568b0905',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c0000000706616d6f756e7401000000000000000000000000006a31f00c626c6f636b2d68656967687401000000000000000000000000000ee25e076d61782d6665650100000000000000000000000000001f4009726563697069656e740c00000002096861736862797465730200000014e35d46afbf65d69cce3472f4bf9b888c375943000776657273696f6e0200000001040a726571756573742d6964010000000000000000000000000000140c0673656e6465720516042148581f5e55a2e8421bdd28817f6fb8fad4d905746f7069630d000000117769746864726177616c2d637265617465',
              repr: '(tuple (amount u6959600) (block-height u975454) (max-fee u8000) (recipient (tuple (hashbytes 0xe35d46afbf65d69cce3472f4bf9b888c37594300) (version 0x04))) (request-id u5132) (sender \'SP222J2R3XF5B8Q888DXTA41FXQVHYPMV4JD2WQK) (topic "withdrawal-create"))',
            },
          },
        },
      ],
      event_count: 3,
      vm_error: null,
    },
    requestRawTx:
      '0x00000000010400042148581f5e55a2e8421bdd28817f6fb8fad4d9000000000000000a0000000000000bb80000583f3f08affda3458fc23cd8aa7573ac845838052c8cd92d8a80b6cd6b0e74f12ddc7b5b951670d51be2e394eb121c63052425ef78f60ca144df4e52984121f3030200000001010216042148581f5e55a2e8421bdd28817f6fb8fad4d914f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0a736274632d746f6b656e0a736274632d746f6b656e0500000000006a51300214f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0f736274632d7769746864726177616c1b696e6974696174652d7769746864726177616c2d726571756573740000000301000000000000000000000000006a31f00c00000002096861736862797465730200000014e35d46afbf65d69cce3472f4bf9b888c375943000776657273696f6e0200000001040100000000000000000000000000001f40',
    getWithdrawalRequest:
      '0x0a0c0000000606616d6f756e7401000000000000000000000000006a31f00c626c6f636b2d68656967687401000000000000000000000000000ee25e076d61782d6665650100000000000000000000000000001f4009726563697069656e740c00000002096861736862797465730200000014e35d46afbf65d69cce3472f4bf9b888c375943000776657273696f6e0200000001040673656e6465720516042148581f5e55a2e8421bdd28817f6fb8fad4d9067374617475730a03',
    getSweepData:
      '0x0a0c000000030f73776565702d6275726e2d68617368020000002000000000000000000000c8372e1626ff54e8d992e348103dec0af031af1ce4b21173776565702d6275726e2d68656967687401000000000000000000000000000ee2660a73776565702d747869640200000020632b7304cd9876028747084d770b5af2ae0190e2117f0270557e927247b7fd59',
    emily: {
      requestId: 5132,
      stacksBlockHash: 'a38e872bf8756dd55cb2d8130fe42ef46f3923443f60a2320648309814f7115f',
      stacksBlockHeight: 9463222,
      recipient: '0014e35d46afbf65d69cce3472f4bf9b888c37594300',
      sender: 'SP222J2R3XF5B8Q888DXTA41FXQVHYPMV4JD2WQK',
      amount: 6959600,
      lastUpdateHeight: 9463512,
      lastUpdateBlockHash: 'be9f086674ee4c3b035525a41a38261093272708bfbd497fe037dbdac7539e75',
      status: 'confirmed',
      statusMessage:
        'Included in block be9f086674ee4c3b035525a41a38261093272708bfbd497fe037dbdac7539e75',
      parameters: {
        maxFee: 8000,
      },
      fulfillment: {
        BitcoinTxid: '632b7304cd9876028747084d770b5af2ae0190e2117f0270557e927247b7fd59',
        BitcoinTxIndex: 2,
        StacksTxid: '4ec3784bbe5b130b15940f0bb67c56cff49b699f70d55c063d9f746a7ae3b279',
        BitcoinBlockHash: '00000000000000000000c8372e1626ff54e8d992e348103dec0af031af1ce4b2',
        BitcoinBlockHeight: 975462,
        BtcFee: 151,
      },
      expectedFulfillmentInfo: {
        bitcoinBlockHeight: 975461,
        bitcoinTxid: '632b7304cd9876028747084d770b5af2ae0190e2117f0270557e927247b7fd59',
      },
      txid: 'ef1b5a170a8cbd90088dbc2079240f82194ad1322f469a082a197a43568b0905',
    },
    acceptTx: {
      tx_id: '0x4ec3784bbe5b130b15940f0bb67c56cff49b699f70d55c063d9f746a7ae3b279',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SM37A2MMXMKEHTZ0N6N81TFF4XEA62J2ZR3NM7BW8',
      sponsored: false,
      nonce: 25907,
      fee_rate: '13848',
      block_height: 9463512,
      burn_block_height: 975461,
      tx_result: {
        hex: '0x0703',
        repr: '(ok true)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'accept-withdrawal-request',
        function_signature:
          '(define-public (accept-withdrawal-request (request-id uint) (bitcoin-txid (buff 32)) (signer-bitmap uint) (output-index uint) (fee uint) (burn-hash (buff 32)) (burn-height uint) (sweep-txid (buff 32))))',
        function_args: [
          {
            hex: '0x010000000000000000000000000000140c',
            repr: 'u5132',
            name: 'request-id',
            type: 'uint',
          },
          {
            hex: '0x0200000020632b7304cd9876028747084d770b5af2ae0190e2117f0270557e927247b7fd59',
            repr: '0x632b7304cd9876028747084d770b5af2ae0190e2117f0270557e927247b7fd59',
            name: 'bitcoin-txid',
            type: '(buff 32)',
          },
          {
            hex: '0x0100000000000000000000000000000000',
            repr: 'u0',
            name: 'signer-bitmap',
            type: 'uint',
          },
          {
            hex: '0x0100000000000000000000000000000002',
            repr: 'u2',
            name: 'output-index',
            type: 'uint',
          },
          {
            hex: '0x0100000000000000000000000000000097',
            repr: 'u151',
            name: 'fee',
            type: 'uint',
          },
          {
            hex: '0x020000002000000000000000000000c8372e1626ff54e8d992e348103dec0af031af1ce4b2',
            repr: '0x00000000000000000000c8372e1626ff54e8d992e348103dec0af031af1ce4b2',
            name: 'burn-hash',
            type: '(buff 32)',
          },
          {
            hex: '0x01000000000000000000000000000ee266',
            repr: 'u975462',
            name: 'burn-height',
            type: 'uint',
          },
          {
            hex: '0x0200000020632b7304cd9876028747084d770b5af2ae0190e2117f0270557e927247b7fd59',
            repr: '0x632b7304cd9876028747084d770b5af2ae0190e2117f0270557e927247b7fd59',
            name: 'sweep-txid',
            type: '(buff 32)',
          },
        ],
      },
      post_condition_mode: 'allow',
      post_conditions: [],
      events: [
        {
          event_index: 2,
          event_type: 'smart_contract_log',
          tx_id: '0x4ec3784bbe5b130b15940f0bb67c56cff49b699f70d55c063d9f746a7ae3b279',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c000000090c626974636f696e2d747869640200000020632b7304cd9876028747084d770b5af2ae0190e2117f0270557e927247b7fd59096275726e2d68617368020000002000000000000000000000c8372e1626ff54e8d992e348103dec0af031af1ce4b20b6275726e2d68656967687401000000000000000000000000000ee2660366656501000000000000000000000000000000970c6f75747075742d696e64657801000000000000000000000000000000020a726571756573742d6964010000000000000000000000000000140c0d7369676e65722d6269746d617001000000000000000000000000000000000a73776565702d747869640200000020632b7304cd9876028747084d770b5af2ae0190e2117f0270557e927247b7fd5905746f7069630d000000117769746864726177616c2d616363657074',
              repr: '(tuple (bitcoin-txid 0x632b7304cd9876028747084d770b5af2ae0190e2117f0270557e927247b7fd59) (burn-hash 0x00000000000000000000c8372e1626ff54e8d992e348103dec0af031af1ce4b2) (burn-height u975462) (fee u151) (output-index u2) (request-id u5132) (signer-bitmap u0) (sweep-txid 0x632b7304cd9876028747084d770b5af2ae0190e2117f0270557e927247b7fd59) (topic "withdrawal-accept"))',
            },
          },
        },
      ],
      event_count: 3,
      vm_error: null,
    },
    btcTx: {
      txid: '632b7304cd9876028747084d770b5af2ae0190e2117f0270557e927247b7fd59',
      weight: 6687,
      fee: 6428,
      vin: [
        {
          txid: '047bc1d9d7ee3fa63d6b41f92bf0508ceeb7b82e90925ee444a9e0ed1396f537',
          vout: 0,
        },
        {
          txid: 'cc3198e4bd77aca8588aa0617a298781a5c7dab02e25215f3041e0c462c01b09',
          vout: 1,
        },
        {
          txid: '47be257d3e31bdaa1a5aa89103d159a35243153c82a426f717b62db7def6bb17',
          vout: 1,
        },
        {
          txid: '6d204287bbcf9b83da40e3fd6627ab87dc53a43e9c1b7010cb977fed1228aa1f',
          vout: 1,
        },
        {
          txid: '3f2705d27b9ace4d3abfdd20b2c4fa7776bbc3b16f5d20f8fcccb0b8be3f412a',
          vout: 1,
        },
        {
          txid: 'a429fd686226e373dc242d20468f648ce638fba2779fafb9894e46de4015ef31',
          vout: 1,
        },
        {
          txid: '90ee843373104ae47f77af6985b05d69869b207b8075c5eb97ab83533bb8b63a',
          vout: 1,
        },
        {
          txid: '4cfe01979dc4e6958839deda683ae149a05fcc09e8aec5f9d9e4022e5ab99243',
          vout: 1,
        },
        {
          txid: 'b96b4d6c944c9d79142f90e33b05dc9f34370222354923b930e7d7270eea0073',
          vout: 1,
        },
        {
          txid: 'e82d5e9c1b3061bc1d01724d5b0581326d8bb384757e3d244c8b4aacb405b578',
          vout: 1,
        },
        {
          txid: '30d394d8c269ba9449ec9f7c85de105f0b4d7e3546f4cbba08272f1c761b078d',
          vout: 1,
        },
        {
          txid: 'c37c3fab65d7067df6e2d0c54fc5d913cabea6730c67449ef7ea42b3f25d7ea5',
          vout: 1,
        },
        {
          txid: '37cfb6b6a17cc8c97fae44134e961fd8230bad6d8a382b5b9cd250becdfed7b1',
          vout: 1,
        },
        {
          txid: '803e071b4ed6b7a69661bef2e0f4b1705b1a497371d3e58d5e95f0df4773adb2',
          vout: 1,
        },
        {
          txid: 'dcd03cd882b6c6e74b3dec1964055e91312430beaa089b0875d69bdcde60bbeb',
          vout: 1,
        },
      ],
      vout: [
        {
          scriptpubkey: '51208056b53d7e41f8f80b4a2daa457b07f81b1b5f42036152c7d055cd9c7fcdf753',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1psptt20t7g8u0sz629k4y27c8lqd3kh6zqds4937s2hxecl7d7afsrhteyx',
          value: 247881388854,
        },
        {
          scriptpubkey: '6a065433018c2800',
          scriptpubkey_type: 'op_return',
          value: 0,
        },
        {
          scriptpubkey: '0014e35d46afbf65d69cce3472f4bf9b888c37594300',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qudw5dtalvhtfen35wt6tlxug3sm4jscqpm0uz4',
          value: 6959600,
        },
      ],
      status: {
        confirmed: true,
        block_height: 975462,
        block_hash: '00000000000000000000c8372e1626ff54e8d992e348103dec0af031af1ce4b2',
        block_time: 1794420529,
      },
    },
    btcTxHex:
      '0200000000010f37f59613ede0a944e45e92902eb8b7ee8c50f02bf9416b3da63feed7d9c17b04000000000000000000091bc062c4e041305f21252eb0dac7a58187297a61a08a58a8ac77bde49831cc01000000000000000017bbf6deb72db617f726a4823c154352a359d10391a85a1aaabd313e7d25be470100000000000000001faa2812ed7f97cb10701b9c3ea453dc87ab2766fde340da839bcfbb8742206d0100000000000000002a413fbeb8b0ccfcf8205d6fb1c3bb7677fac4b220ddbf3a4dce9a7bd205273f01000000000000000031ef1540de464e89b9af9f77a2fb38e68c648f46202d24dc73e3266268fd29a40100000000000000003ab6b83b5383ab97ebc575807b209b86695db08569af777fe44a10733384ee900100000000000000004392b95a2e02e4d9f9c5aee809cc5fa049e13a68dade398895e6c49d9701fe4c0100000000000000007300ea0e27d7e730b9234935220237349fdc053be3902f14799d4c946c4d6bb901000000000000000078b505b4ac4a8b4c243d7e7584b38b6d3281055b4d72011dbc61301b9c5e2de80100000000000000008d071b761c2f2708bacbf446357e4d0b5f10de857c9fec4994ba69c2d894d330010000000000000000a57e5df2b342eaf79e44670c73a6beca13d9c54fc5d0e2f67d06d765ab3f7cc3010000000000000000b1d7fecdbe50d29c5b2b388a6dad0b23d81f964e1344ae7fc9c87ca1b6b6cf37010000000000000000b2ad7347dff0955e8de5d37173491a5b70b1f4e0f2be6196a6b7d64e1b073e80010000000000000000ebbb60dedc9bd675089b08aabe302431915e056419ec3d4be7c6b682d83cd0dc0100000000000000000336d3e1b6390000002251208056b53d7e41f8f80b4a2daa457b07f81b1b5f42036152c7d055cd9c7fcdf7530000000000000000086a065433018c2800f0316a0000000000160014e35d46afbf65d69cce3472f4bf9b888c375943000d00408373127b091cf3aaade8b9bccd73e58d4661b23f5a9fee986cd8cc75eeff565bec5b2fc3451c23773e6807fef8f29e6232dbc756392cffe0e3dced083aeb9585404c0382ec2fb2210fc11816627b028205213aa538dcd73e83b14bc6868aa0d2fdfa1a53b4e13300f4ee9f0f1275f1edef5c180a75fc1474d3db4c27d5f6b7a9ff4029740cb7411dd68569e72814b325deae5e3f9ceefef7467b579e325eadefa249c2f184d8ad8069eb6716193b94edbf55f8d6404a502c163d8bf6e91c77ceddfa00401f2164f50e67836e9b70b00817de42dbe34a58939b5058bd414d2647222533e60e3615953873e85453c41e1927aeafc3ff6f67b728229ae01361551963ac6dbe401232c34f411cd05e2b3af7fa5cd4f5e5f05b4105ebb4b637114a5a6ba71e12d8077fb22919fdb99a0b246a2aa335eef7df54cca4a9d0fb218a06e5ca4ac343af4096b23422ae00cd897cfee0a8035ade0bda689b668ba21cdcba09a8b9d070abc5e6f45fc63b06b0181149e680c119f39019da94903845f8e5ad77e35c7b50da2f40858bf80c4603886d0e4151cbf48aea5ca73bcc6e5f296e3761921b5ca96c430e5c3c9133fe2e8bf2c7c53ad88e41bc9f82888434a83b340c62d221369cc7d18440ec4d71f8346162cdc7028784441d4d614cf66c4d7394a409c3dc050251fa182742c6539b57afb694f776d39942e24a4585cb6534294ab1d881334ac8f84fd0bd00fd780120045a602c7d83dfd1e7f576f611a26bbf7eae6d6b5f0a022b75684ffe4a8e5432ac201a39d16a6ffaa40fe404e64bc373c47bae126bd3d96dfcac5aa9c2137e089888ba201b6bf6534a8d3176db2e31063db3b1f35221c424306ee9a6b4ac50a46e7ee02eba202772abd64d7d82fa22700ebc9575d69548b699c04201f0d77e8e9602f58d8b64ba204505a302b1e030f1220b4e489c5ee28b855a4060e5a5e13fc739850b413a3121ba207a63f798bdcc5857c12c345f8373ba9167a93f431a3fe8be4fd74f9bbc0076fdba207b3e2369356df5edf768a5218f49c2a1ab871b46550d7ec8156bf2b378b38020ba20852d177ca592ee878b1272d6d166b694d5d419c07508246b07656c22f46b807bba20a3cc2583c4f46a92edace6621fa9dc592dd2fb674d7c5af6e59303f8648bd58eba20ac681c61c24074c42834d798b07d2ab5bdb6da7ea493f25cb3e691ceed663b33ba20ad20fef55bdcb8e14bf9c2de447b20ab36b3cd05261c7fc1e936f94d3514f7d2ba589c21c14a30b2e461b280c0b13a03799096ab1256589153fc4b9c8cead16dc0b642069703419516f0c6abf97e7571335ca6ed36c64391e741817891916a1834126757136bc3cbfbcd9349f6bf77b28117d55d17a3eb61aa97840cd449f57407c305ecf4b71901482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403410e3507778d555b5fab428b1c3905ebc95d1ae171d1c899fb326481610a1c767ff1ffb4b0f54e7ba5c848d131d8b267604f643609cd4bffa855bb19853e4433e301482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb3953614034182b0601fd19d58ec4adeaabc336bfea448c791801c46bbed727bcbfdb612fba131e91bec82234606a1c6559b61b3abe746a0cc1bd5821aac90cce0587dc0291801482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341a8845cef5ba4b51f4f0200019ac2eee14b500f889d4589549b654fa208b43cd570b77c743d9fdf70e234feb4940a91e95726f8c0af1850d64af41c0eae2943fc01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb3953614034165bd8ad0767817d8a9002f1f6e701c18ae5c3a3cfa685cec144a612e0c39e35c1ff2e1f833be5c5d5122a810baac246671fc5921944c34f21f9dbadb9047c33901482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403417cc8be7581bcf1babca8face979bdcac017d5d99c7c9be02334ab7d80d8606464f084d39780263a5b7f5dd2ac2faf79018d3b492ae01f1b5ff37ba2d44be242801482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341886c9fc0c9ac668d208ee4e3ca35cfa635aa402939dc1f1ae88ce94dcd4b62fe048be2d9951ad7f506a1db1e5ea19b2f426bee6b74e5ecc4d0fc0726cdf8595e01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341bc3ef155b67736137cf572def4b65b3f33b3efffb15cc784f302319f955033412f49942ca1d5e30c9c34571286f2493611e085c9f1cd680767250fb8fc2aa05901482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb3953614034157d9c4db29d44efb0f6aef1423b4b5c96cedb96bd64bb87f82e679794ef91abf9ff918adaa5c96075e83c33d4ea31f2691e560adbb94c4f34702ed26808b4a7d01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403416cc141731907fb5bf61e26ed48002bd99a0d9714c2a3e8b572ba3d8bc6549cdb930968bac0f20df34e8c33a2b6139595513a733cb82badc6041334d123df682201482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb3953614034191d6bb5cfdbe0ac80543c89236d8caba42e80253048ce923194255b3acc774b47e183885aef846b3c8df77b06573f07382886e8d21576dfe7627af31e4eed1c501482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403413f81678ebe94dc31c80754c6a64f05082fcdc96bbf38ba3199f6534852cdcb1d58707bb3cd465054aa696ccb228c51b7cefe9ca71a9f230741ecfeb33568e56901482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341785854457d73c263aa974d8ccddd07dab043ec5451a6503091daebcd0ec432a0c5e02193b8daba9c232489abbb6b279bea58920231964ab4077b90773d006ec501482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb3953614034140c47b8215f4190e05ac84571d84c730167ea0cbb9e4fa94b481f9e41e22c86bb2176c1f6587bbaf1bb6c5ae6010519ed85e88fcfbf0b91f55091df5a294d5a301482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361400000000',
  },
  {
    id: 5119,
    outcome: 'accepted',
    kind: 'p2tr',
    direct: true,
    requestTxid: '846e4986ef4ac2698fe98a6075a00e90641f94ef4ab169d5db9ab443ed19a84f',
    sender: 'SP9X50Z52TX1EYHGRAM9B12J567W0XBEPK0151X1',
    amountSats: 3823487,
    maxFeeSats: 1600,
    burnHeight: 975275,
    version: '06',
    hashbytes: '2b0b8a4f0af6a1e5110eab85ba14650404a9dc65f1b8be950a7b145d90d8f10c',
    scriptPubKey: '51202b0b8a4f0af6a1e5110eab85ba14650404a9dc65f1b8be950a7b145d90d8f10c',
    address: 'bc1p9v9c5nc276s72ygw4wzm59r9qsz2nhr97xuta9g20v29myxc7yxqenpe6g',
    payoutTxid: '7c185b6b615a9849e344ab2434dd39addb2c5b1b8502722dee2d0c1dde9531d8',
    payoutVout: 2,
    feeSats: 105,
    acceptTxid: 'e9418584b4410185a980445ea8ba9d19e6d9795f189a4ff978f22dea36195d6f',
    requestTx: {
      tx_id: '0x846e4986ef4ac2698fe98a6075a00e90641f94ef4ab169d5db9ab443ed19a84f',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SP9X50Z52TX1EYHGRAM9B12J567W0XBEPK0151X1',
      sponsored: false,
      nonce: 32,
      fee_rate: '3000',
      block_height: 9453683,
      burn_block_height: 975274,
      tx_result: {
        hex: '0x0701000000000000000000000000000013ff',
        repr: '(ok u5119)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'initiate-withdrawal-request',
        function_signature:
          '(define-public (initiate-withdrawal-request (amount uint) (recipient (tuple (hashbytes (buff 32)) (version (buff 1)))) (max-fee uint)))',
        function_args: [
          {
            hex: '0x01000000000000000000000000003a577f',
            repr: 'u3823487',
            name: 'amount',
            type: 'uint',
          },
          {
            hex: '0x0c000000020968617368627974657302000000202b0b8a4f0af6a1e5110eab85ba14650404a9dc65f1b8be950a7b145d90d8f10c0776657273696f6e020000000106',
            repr: '(tuple (hashbytes 0x2b0b8a4f0af6a1e5110eab85ba14650404a9dc65f1b8be950a7b145d90d8f10c) (version 0x06))',
            name: 'recipient',
            type: '(tuple (hashbytes (buff 32)) (version (buff 1)))',
          },
          {
            hex: '0x0100000000000000000000000000000640',
            repr: 'u1600',
            name: 'max-fee',
            type: 'uint',
          },
        ],
      },
      post_condition_mode: 'deny',
      post_conditions: [
        {
          principal: {
            type_id: 'principal_standard',
            address: 'SP9X50Z52TX1EYHGRAM9B12J567W0XBEPK0151X1',
          },
          condition_code: 'sent_less_than_or_equal_to',
          amount: '3825087',
          type: 'fungible',
          asset: {
            asset_name: 'sbtc-token',
            contract_address: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4',
            contract_name: 'sbtc-token',
          },
        },
      ],
      events: [
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          tx_id: '0x846e4986ef4ac2698fe98a6075a00e90641f94ef4ab169d5db9ab443ed19a84f',
          asset: {
            asset_event_type: 'burn',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token',
            sender: 'SP9X50Z52TX1EYHGRAM9B12J567W0XBEPK0151X1',
            recipient: '',
            amount: '3825087',
          },
        },
        {
          event_index: 1,
          event_type: 'fungible_token_asset',
          tx_id: '0x846e4986ef4ac2698fe98a6075a00e90641f94ef4ab169d5db9ab443ed19a84f',
          asset: {
            asset_event_type: 'mint',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token-locked',
            sender: '',
            recipient: 'SP9X50Z52TX1EYHGRAM9B12J567W0XBEPK0151X1',
            amount: '3825087',
          },
        },
        {
          event_index: 2,
          event_type: 'smart_contract_log',
          tx_id: '0x846e4986ef4ac2698fe98a6075a00e90641f94ef4ab169d5db9ab443ed19a84f',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c0000000706616d6f756e7401000000000000000000000000003a577f0c626c6f636b2d68656967687401000000000000000000000000000ee1ab076d61782d666565010000000000000000000000000000064009726563697069656e740c000000020968617368627974657302000000202b0b8a4f0af6a1e5110eab85ba14650404a9dc65f1b8be950a7b145d90d8f10c0776657273696f6e0200000001060a726571756573742d696401000000000000000000000000000013ff0673656e646572051613d283e516ba177a30c2a8958452298fc0756eb405746f7069630d000000117769746864726177616c2d637265617465',
              repr: '(tuple (amount u3823487) (block-height u975275) (max-fee u1600) (recipient (tuple (hashbytes 0x2b0b8a4f0af6a1e5110eab85ba14650404a9dc65f1b8be950a7b145d90d8f10c) (version 0x06))) (request-id u5119) (sender \'SP9X50Z52TX1EYHGRAM9B12J567W0XBEPK0151X1) (topic "withdrawal-create"))',
            },
          },
        },
      ],
      event_count: 3,
      vm_error: null,
    },
    requestRawTx:
      '0x0000000001040013d283e516ba177a30c2a8958452298fc0756eb400000000000000200000000000000bb80000397159c0df3d00b9f550cd5afcb93e844081480340ff891f490b300dcf2c7aa74ab80d0eadb1df641bac4b3bc502f1ca7d9b2a1499308491b5203389e3a5e47e03020000000101021613d283e516ba177a30c2a8958452298fc0756eb414f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0a736274632d746f6b656e0a736274632d746f6b656e0500000000003a5dbf0214f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0f736274632d7769746864726177616c1b696e6974696174652d7769746864726177616c2d726571756573740000000301000000000000000000000000003a577f0c000000020968617368627974657302000000202b0b8a4f0af6a1e5110eab85ba14650404a9dc65f1b8be950a7b145d90d8f10c0776657273696f6e0200000001060100000000000000000000000000000640',
    getWithdrawalRequest:
      '0x0a0c0000000606616d6f756e7401000000000000000000000000003a577f0c626c6f636b2d68656967687401000000000000000000000000000ee1ab076d61782d666565010000000000000000000000000000064009726563697069656e740c000000020968617368627974657302000000202b0b8a4f0af6a1e5110eab85ba14650404a9dc65f1b8be950a7b145d90d8f10c0776657273696f6e0200000001060673656e646572051613d283e516ba177a30c2a8958452298fc0756eb4067374617475730a03',
    getSweepData:
      '0x0a0c000000030f73776565702d6275726e2d68617368020000002000000000000000000000cabca502599e739bdcc3df0233689b1329a207ffdd1f1173776565702d6275726e2d68656967687401000000000000000000000000000ee1b30a73776565702d7478696402000000207c185b6b615a9849e344ab2434dd39addb2c5b1b8502722dee2d0c1dde9531d8',
    emily: {
      requestId: 5119,
      stacksBlockHash: '8d09665bf0fc132aae4016e71295bd9630c26a4f185d416d4e430bdbee528b0a',
      stacksBlockHeight: 9453683,
      recipient: '51202b0b8a4f0af6a1e5110eab85ba14650404a9dc65f1b8be950a7b145d90d8f10c',
      sender: 'SP9X50Z52TX1EYHGRAM9B12J567W0XBEPK0151X1',
      amount: 3823487,
      lastUpdateHeight: 9454316,
      lastUpdateBlockHash: 'ecdc1a4ccf44ca5133e438fdc82b86969c719f55cb2dcc24b5a08dd64e37a4e3',
      status: 'confirmed',
      statusMessage:
        'Included in block ecdc1a4ccf44ca5133e438fdc82b86969c719f55cb2dcc24b5a08dd64e37a4e3',
      parameters: {
        maxFee: 1600,
      },
      fulfillment: {
        BitcoinTxid: '7c185b6b615a9849e344ab2434dd39addb2c5b1b8502722dee2d0c1dde9531d8',
        BitcoinTxIndex: 2,
        StacksTxid: 'e9418584b4410185a980445ea8ba9d19e6d9795f189a4ff978f22dea36195d6f',
        BitcoinBlockHash: '00000000000000000000cabca502599e739bdcc3df0233689b1329a207ffdd1f',
        BitcoinBlockHeight: 975283,
        BtcFee: 105,
      },
      expectedFulfillmentInfo: {
        bitcoinBlockHeight: 975281,
        bitcoinTxid: '7c185b6b615a9849e344ab2434dd39addb2c5b1b8502722dee2d0c1dde9531d8',
      },
      txid: '846e4986ef4ac2698fe98a6075a00e90641f94ef4ab169d5db9ab443ed19a84f',
    },
    acceptTx: {
      tx_id: '0xe9418584b4410185a980445ea8ba9d19e6d9795f189a4ff978f22dea36195d6f',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SM37A2MMXMKEHTZ0N6N81TFF4XEA62J2ZR3NM7BW8',
      sponsored: false,
      nonce: 24884,
      fee_rate: '5692',
      block_height: 9454316,
      burn_block_height: 975281,
      tx_result: {
        hex: '0x0703',
        repr: '(ok true)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'accept-withdrawal-request',
        function_signature:
          '(define-public (accept-withdrawal-request (request-id uint) (bitcoin-txid (buff 32)) (signer-bitmap uint) (output-index uint) (fee uint) (burn-hash (buff 32)) (burn-height uint) (sweep-txid (buff 32))))',
        function_args: [
          {
            hex: '0x01000000000000000000000000000013ff',
            repr: 'u5119',
            name: 'request-id',
            type: 'uint',
          },
          {
            hex: '0x02000000207c185b6b615a9849e344ab2434dd39addb2c5b1b8502722dee2d0c1dde9531d8',
            repr: '0x7c185b6b615a9849e344ab2434dd39addb2c5b1b8502722dee2d0c1dde9531d8',
            name: 'bitcoin-txid',
            type: '(buff 32)',
          },
          {
            hex: '0x0100000000000000000000000000000000',
            repr: 'u0',
            name: 'signer-bitmap',
            type: 'uint',
          },
          {
            hex: '0x0100000000000000000000000000000002',
            repr: 'u2',
            name: 'output-index',
            type: 'uint',
          },
          {
            hex: '0x0100000000000000000000000000000069',
            repr: 'u105',
            name: 'fee',
            type: 'uint',
          },
          {
            hex: '0x020000002000000000000000000000cabca502599e739bdcc3df0233689b1329a207ffdd1f',
            repr: '0x00000000000000000000cabca502599e739bdcc3df0233689b1329a207ffdd1f',
            name: 'burn-hash',
            type: '(buff 32)',
          },
          {
            hex: '0x01000000000000000000000000000ee1b3',
            repr: 'u975283',
            name: 'burn-height',
            type: 'uint',
          },
          {
            hex: '0x02000000207c185b6b615a9849e344ab2434dd39addb2c5b1b8502722dee2d0c1dde9531d8',
            repr: '0x7c185b6b615a9849e344ab2434dd39addb2c5b1b8502722dee2d0c1dde9531d8',
            name: 'sweep-txid',
            type: '(buff 32)',
          },
        ],
      },
      post_condition_mode: 'allow',
      post_conditions: [],
      events: [
        {
          event_index: 2,
          event_type: 'smart_contract_log',
          tx_id: '0xe9418584b4410185a980445ea8ba9d19e6d9795f189a4ff978f22dea36195d6f',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c000000090c626974636f696e2d7478696402000000207c185b6b615a9849e344ab2434dd39addb2c5b1b8502722dee2d0c1dde9531d8096275726e2d68617368020000002000000000000000000000cabca502599e739bdcc3df0233689b1329a207ffdd1f0b6275726e2d68656967687401000000000000000000000000000ee1b30366656501000000000000000000000000000000690c6f75747075742d696e64657801000000000000000000000000000000020a726571756573742d696401000000000000000000000000000013ff0d7369676e65722d6269746d617001000000000000000000000000000000000a73776565702d7478696402000000207c185b6b615a9849e344ab2434dd39addb2c5b1b8502722dee2d0c1dde9531d805746f7069630d000000117769746864726177616c2d616363657074',
              repr: '(tuple (bitcoin-txid 0x7c185b6b615a9849e344ab2434dd39addb2c5b1b8502722dee2d0c1dde9531d8) (burn-hash 0x00000000000000000000cabca502599e739bdcc3df0233689b1329a207ffdd1f) (burn-height u975283) (fee u105) (output-index u2) (request-id u5119) (signer-bitmap u0) (sweep-txid 0x7c185b6b615a9849e344ab2434dd39addb2c5b1b8502722dee2d0c1dde9531d8) (topic "withdrawal-accept"))',
            },
          },
        },
      ],
      event_count: 3,
      vm_error: null,
    },
    btcTx: {
      txid: '7c185b6b615a9849e344ab2434dd39addb2c5b1b8502722dee2d0c1dde9531d8',
      weight: 5625,
      fee: 2574,
      vin: [
        {
          txid: 'c11043eb60506e4b82f5db43a6322c5bc37fc60b1b7340858fdf85fd032f725a',
          vout: 0,
        },
        {
          txid: '893e41853f0b323d10d4e4ecd34e87d2cd01734c7660542d3d8b3c2373a37613',
          vout: 1,
        },
        {
          txid: '129e9ee4415f9b2c9f7b91de169ccaa8171b6c6e4c51c8600492c51cea32fc39',
          vout: 1,
        },
        {
          txid: '1edbff59ea7e9fd01283c8a7e340f95f7cdd336793a858454cbd19faf7c93f59',
          vout: 1,
        },
        {
          txid: 'b77c38912ff9ecc37ee00826907a71b42dd7ae72f23aaa2d269def5966b52264',
          vout: 1,
        },
        {
          txid: '58478c9308215ae2293a09bd8d204538dc3d4be20811fa68d5df3ea1b7f1e66d',
          vout: 1,
        },
        {
          txid: '39ffdeec654b176884487f1c94b4f3d545a5ae0b9a5b0755563879bf816d258b',
          vout: 1,
        },
        {
          txid: '34b5219001a2669510404b61a41374bf298ff5c12ab67e075f71c894a8db0c9e',
          vout: 1,
        },
        {
          txid: 'fd845b15e8b47054ec6df2af8f456ac83cae98d1f24092c7320657e64bb92eb2',
          vout: 1,
        },
        {
          txid: '01b7ebadc237e979df0775c8d8e9c1dcaf3d8b9b0b77018be45e474694587ec8',
          vout: 1,
        },
        {
          txid: 'e4ccedaaa00e2dfa40f7cd953887c66bbaefec58eb67e3986145ba09a7e3cbda',
          vout: 1,
        },
        {
          txid: 'e9ef1fd48797c2520400408f0fba973d781a5280c510882f3d551e1dce4318f8',
          vout: 1,
        },
      ],
      vout: [
        {
          scriptpubkey: '51208056b53d7e41f8f80b4a2daa457b07f81b1b5f42036152c7d055cd9c7fcdf753',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1psptt20t7g8u0sz629k4y27c8lqd3kh6zqds4937s2hxecl7d7afsrhteyx',
          value: 248121204161,
        },
        {
          scriptpubkey: '6a06543301ff2700',
          scriptpubkey_type: 'op_return',
          value: 0,
        },
        {
          scriptpubkey: '51202b0b8a4f0af6a1e5110eab85ba14650404a9dc65f1b8be950a7b145d90d8f10c',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1p9v9c5nc276s72ygw4wzm59r9qsz2nhr97xuta9g20v29myxc7yxqenpe6g',
          value: 3823487,
        },
      ],
      status: {
        confirmed: true,
        block_height: 975283,
        block_hash: '00000000000000000000cabca502599e739bdcc3df0233689b1329a207ffdd1f',
        block_time: 1794305166,
      },
    },
    btcTxHex:
      '0200000000010c5a722f03fd85df8f8540731b0bc67fc35b2c32a643dbf5824b6e5060eb4310c10000000000000000001376a373233c8b3d2d5460764c7301cdd2874ed3ece4d4103d320b3f85413e8901000000000000000039fc32ea1cc5920460c8514c6e6c1b17a8ca9c16de917b9f2c9b5f41e49e9e12010000000000000000593fc9f7fa19bd4c4558a8936733dd7c5ff940e3a7c88312d09f7eea59ffdb1e0100000000000000006422b56659ef9d262daa3af272aed72db4717a902608e07ec3ecf92f91387cb70100000000000000006de6f1b7a13edfd568fa1108e24b3ddc3845208dbd093a29e25a2108938c47580100000000000000008b256d81bf79385655075b9a0baea545d5f3b4941c7f488468174b65ecdeff390100000000000000009e0cdba894c8715f077eb62ac1f58f29bf7413a4614b40109566a2019021b534010000000000000000b22eb94be6570632c79240f2d198ae3cc86a458faff26dec5470b4e8155b84fd010000000000000000c87e589446475ee48b01770b9b8b3dafdcc1e9d8c87507df79e937c2adebb701010000000000000000dacbe3a709ba456198e367eb58ecefba6bc6873895cdf740fa2d0ea0aaedcce4010000000000000000f81843ce1d1e553d2f8810c580521a783d97ba0f8f40000452c29787d41fefe901000000000000000003c11d2dc5390000002251208056b53d7e41f8f80b4a2daa457b07f81b1b5f42036152c7d055cd9c7fcdf7530000000000000000086a06543301ff27007f573a00000000002251202b0b8a4f0af6a1e5110eab85ba14650404a9dc65f1b8be950a7b145d90d8f10c0d40755fe214b0da6ff17de40a3c59da1a62b4f1bbd34adb5495d51f5384c2016bb188bc2e7382018928f4c50aa8fc3e9be905fe61e3d75bfe8dc476b428d64a81ce402221837e722c74e49ff7c4d8f4ffa17d58cba607592be1afa3c86185d14bd97bd6c32e246325e64ff9a9506cda7b27729c2c6773e4fef295ef8756be3938c1b7405d2136d73d92978a1eb48699924bc6b526beefdb250fe4a802215718f45d1313f127f9a24e40765737e7e6ab4b3ca54fdd701b3f8f1d77446aa52e9292f41ab6000040107dd66164e80af628a13b996345d1d72a135bad89ae460c34ea01f6329d7d849633d67eee8e1839f7856108d407d2d1dd23c4f81a02caab35cf24d5ff818b5f40a9f864296f535e91447bdc7b5f5d72793f2d3fbd86ad5ecbb9d09af6a4662d85db98b8f24b9db59d5cf77e2739c238e943096b394e9060abce64431ff7e8c08d4063189879aeae46bff634e31f1f4f76b4bd16758b8ceba6f65d530a097f18692db8d97f7886f174182acd711bdeff46fba2b3bf691de6ff5efb5e9aaf4de0f9314053134ee27054291965eca3ff73c8c4226fa366f5b96d2284091afe35f92270d1956ca75df7a06b886f50d6a6ce4a43b682204acc0360ad6e221d07c37212902d408cd0d2d53561d1002c19c327ec899954d3354e8574cf1f7faf9338fd75ccef3e3c888db4003f31ff45bb2bac4c9e57294aa9805573d54f43a41d87c4565a263e00fd780120045a602c7d83dfd1e7f576f611a26bbf7eae6d6b5f0a022b75684ffe4a8e5432ac201a39d16a6ffaa40fe404e64bc373c47bae126bd3d96dfcac5aa9c2137e089888ba201b6bf6534a8d3176db2e31063db3b1f35221c424306ee9a6b4ac50a46e7ee02eba202772abd64d7d82fa22700ebc9575d69548b699c04201f0d77e8e9602f58d8b64ba204505a302b1e030f1220b4e489c5ee28b855a4060e5a5e13fc739850b413a3121ba207a63f798bdcc5857c12c345f8373ba9167a93f431a3fe8be4fd74f9bbc0076fdba207b3e2369356df5edf768a5218f49c2a1ab871b46550d7ec8156bf2b378b38020ba20852d177ca592ee878b1272d6d166b694d5d419c07508246b07656c22f46b807bba20a3cc2583c4f46a92edace6621fa9dc592dd2fb674d7c5af6e59303f8648bd58eba20ac681c61c24074c42834d798b07d2ab5bdb6da7ea493f25cb3e691ceed663b33ba20ad20fef55bdcb8e14bf9c2de447b20ab36b3cd05261c7fc1e936f94d3514f7d2ba589c21c14a30b2e461b280c0b13a03799096ab1256589153fc4b9c8cead16dc0b6420697034183267fa384565d6b25c9d7f639b289eee650a428ab9023fa314b845fa7947a24dbe337c58b465027a0a423ec587aa7a3105e90331bf710551209dd954a01680301482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341bc4852397073b7416bcbccbbf258632382ff0392a8aec0310f97ae2d32f04a7c38519120a37a2feb1c3b99bb28de3694d41b776efb6fdab0c106de00874c475901482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341bab7851dd329c0757a26a67228f12250cd90b26e1b953576c6f82754501eaf915b095fbec4c26cb7f600e381d2453dcd6db6e006d2f9892338a697790221326f01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341145fcb28d885036bd84b3de2a2a6e3f98208af9ff57b3c465517e8b197251096d3797d2936c514adc2e068a00d92c5ec747a8721ed41b79e7507b5968dab424901482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb3953614034186c38c9eac7517dd66542e526b1d6fe23530d13dacd06d3bb55309f2aa7599948c748009606f3f38cc8142330b6ab1e9458d9c4f364f841fccc27561e6540dc601482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341384fae3ea41b270c2d109b12c747a744f8ba8366bf5d6d369f1724336ecfd6b865a61ea4b8f68d43c86b54cc551577b85b5756af01a71bd4662f9144636500fb01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341acf7d99dd78179baeb6f3d914342e76fcc88a5eaa46e39b7f2721b659a9072a3f3b1c5276695b371da57d5104e181e0bf0a9edc05558c2592c028c124de6ee9501482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403419e51599659c8e267850e917c3087937c43cfd03b91f77aa3d00a813b47151524158939de49fba6d88cae15da6e6e364ef7add063135d31ca433566f72f5090eb01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341f9e22f73291a1b7a7d75070cf2eb5195c6a0af339b090c458804c50b8e26d86d222d8e5acdefcef142635dad1b5c6dd390cba2e8516f3cc3241f8ae2e31dafd301482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341edb82b869a3a6d3254787cabefd7a51ead3a96c7ce7df4fcb35a3c5eb6de3756a86dfcbcb24c94d8d579aa6457704eb53de54bd6da49f0227655846c40a73a0601482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341a6c0b2bf55b61e7c2e9d8994235cddc2cb94c54da79e776225a609b8d1f6d565950d4f932881f879f9a1b5cdb4986a5e0156240c13ce10b95282204cac82bfec01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361400000000',
  },
  {
    id: 5125,
    outcome: 'accepted',
    kind: 'p2tr',
    direct: true,
    requestTxid: '9a45a393a3959e4b54c7c06f21a119ec763e204249c777a90400b7a99ed31d5f',
    sender: 'SP3JKNAM9A4YXTJPA4GKJETMVT2QQMN3N2KR58P17',
    amountSats: 481096960,
    maxFeeSats: 3200,
    burnHeight: 975350,
    version: '06',
    hashbytes: '2655c5c22e1a2131f92537afd40e04d157f61c8574621d9840780444ba5fc48b',
    scriptPubKey: '51202655c5c22e1a2131f92537afd40e04d157f61c8574621d9840780444ba5fc48b',
    address: 'bc1pye2uts3wrgsnr7f9x7hagrsy69tlv8y9w33pmxzq0qzyfwjlcj9stegmlw',
    payoutTxid: '9d48950f168e84944879647ae0cf3d2bda903676528ff3b836ec2540c87c3447',
    payoutVout: 2,
    feeSats: 113,
    acceptTxid: 'a7f35fc580c10b53816ab656755524ff4007ae52c74c023a93f3ffad38a47234',
    requestTx: {
      tx_id: '0x9a45a393a3959e4b54c7c06f21a119ec763e204249c777a90400b7a99ed31d5f',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SP3JKNAM9A4YXTJPA4GKJETMVT2QQMN3N2KR58P17',
      sponsored: false,
      nonce: 5,
      fee_rate: '3190',
      block_height: 9457816,
      burn_block_height: 975350,
      tx_result: {
        hex: '0x070100000000000000000000000000001405',
        repr: '(ok u5125)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'initiate-withdrawal-request',
        function_signature:
          '(define-public (initiate-withdrawal-request (amount uint) (recipient (tuple (hashbytes (buff 32)) (version (buff 1)))) (max-fee uint)))',
        function_args: [
          {
            hex: '0x010000000000000000000000001cacf500',
            repr: 'u481096960',
            name: 'amount',
            type: 'uint',
          },
          {
            hex: '0x0c000000020968617368627974657302000000202655c5c22e1a2131f92537afd40e04d157f61c8574621d9840780444ba5fc48b0776657273696f6e020000000106',
            repr: '(tuple (hashbytes 0x2655c5c22e1a2131f92537afd40e04d157f61c8574621d9840780444ba5fc48b) (version 0x06))',
            name: 'recipient',
            type: '(tuple (hashbytes (buff 32)) (version (buff 1)))',
          },
          {
            hex: '0x0100000000000000000000000000000c80',
            repr: 'u3200',
            name: 'max-fee',
            type: 'uint',
          },
        ],
      },
      post_condition_mode: 'deny',
      post_conditions: [
        {
          principal: {
            type_id: 'principal_standard',
            address: 'SP3JKNAM9A4YXTJPA4GKJETMVT2QQMN3N2KR58P17',
          },
          condition_code: 'sent_less_than_or_equal_to',
          amount: '481100160',
          type: 'fungible',
          asset: {
            asset_name: 'sbtc-token',
            contract_address: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4',
            contract_name: 'sbtc-token',
          },
        },
      ],
      events: [
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          tx_id: '0x9a45a393a3959e4b54c7c06f21a119ec763e204249c777a90400b7a99ed31d5f',
          asset: {
            asset_event_type: 'burn',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token',
            sender: 'SP3JKNAM9A4YXTJPA4GKJETMVT2QQMN3N2KR58P17',
            recipient: '',
            amount: '481100160',
          },
        },
        {
          event_index: 1,
          event_type: 'fungible_token_asset',
          tx_id: '0x9a45a393a3959e4b54c7c06f21a119ec763e204249c777a90400b7a99ed31d5f',
          asset: {
            asset_event_type: 'mint',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token-locked',
            sender: '',
            recipient: 'SP3JKNAM9A4YXTJPA4GKJETMVT2QQMN3N2KR58P17',
            amount: '481100160',
          },
        },
        {
          event_index: 2,
          event_type: 'smart_contract_log',
          tx_id: '0x9a45a393a3959e4b54c7c06f21a119ec763e204249c777a90400b7a99ed31d5f',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c0000000706616d6f756e74010000000000000000000000001cacf5000c626c6f636b2d68656967687401000000000000000000000000000ee1f6076d61782d6665650100000000000000000000000000000c8009726563697069656e740c000000020968617368627974657302000000202655c5c22e1a2131f92537afd40e04d157f61c8574621d9840780444ba5fc48b0776657273696f6e0200000001060a726571756573742d696401000000000000000000000000000014050673656e6465720516e53aaa89513ddd4aca2427276a9bd0af7a54751405746f7069630d000000117769746864726177616c2d637265617465',
              repr: '(tuple (amount u481096960) (block-height u975350) (max-fee u3200) (recipient (tuple (hashbytes 0x2655c5c22e1a2131f92537afd40e04d157f61c8574621d9840780444ba5fc48b) (version 0x06))) (request-id u5125) (sender \'SP3JKNAM9A4YXTJPA4GKJETMVT2QQMN3N2KR58P17) (topic "withdrawal-create"))',
            },
          },
        },
      ],
      event_count: 3,
      vm_error: null,
    },
    requestRawTx:
      '0x00000000010400e53aaa89513ddd4aca2427276a9bd0af7a54751400000000000000050000000000000c7600002c2060d38c2304b9aff54de3a1f0611dfc49b6c4098014a7cc4c391ed1fe0f6a5fa9cb95698945b4d0ae64029745b0d8f870b882305fd2e96345834c5c2ef18b030200000001010216e53aaa89513ddd4aca2427276a9bd0af7a54751414f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0a736274632d746f6b656e0a736274632d746f6b656e05000000001cad01800214f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0f736274632d7769746864726177616c1b696e6974696174652d7769746864726177616c2d7265717565737400000003010000000000000000000000001cacf5000c000000020968617368627974657302000000202655c5c22e1a2131f92537afd40e04d157f61c8574621d9840780444ba5fc48b0776657273696f6e0200000001060100000000000000000000000000000c80',
    getWithdrawalRequest:
      '0x0a0c0000000606616d6f756e74010000000000000000000000001cacf5000c626c6f636b2d68656967687401000000000000000000000000000ee1f6076d61782d6665650100000000000000000000000000000c8009726563697069656e740c000000020968617368627974657302000000202655c5c22e1a2131f92537afd40e04d157f61c8574621d9840780444ba5fc48b0776657273696f6e0200000001060673656e6465720516e53aaa89513ddd4aca2427276a9bd0af7a547514067374617475730a03',
    getSweepData:
      '0x0a0c000000030f73776565702d6275726e2d686173680200000020000000000000000000004be6388c1de038390e84305c0bdaa238f8001414cac21173776565702d6275726e2d68656967687401000000000000000000000000000ee1fe0a73776565702d7478696402000000209d48950f168e84944879647ae0cf3d2bda903676528ff3b836ec2540c87c3447',
    emily: {
      requestId: 5125,
      stacksBlockHash: 'f429b0433a9a0ef2e63461c863a7da329958ad6b6f0f821b2cc29c67a54b545c',
      stacksBlockHeight: 9457816,
      recipient: '51202655c5c22e1a2131f92537afd40e04d157f61c8574621d9840780444ba5fc48b',
      sender: 'SP3JKNAM9A4YXTJPA4GKJETMVT2QQMN3N2KR58P17',
      amount: 481096960,
      lastUpdateHeight: 9458209,
      lastUpdateBlockHash: 'ed6e53dc3515041fd463389e7191fcfac0a3863729ff27ce5eccf03f80381a25',
      status: 'confirmed',
      statusMessage:
        'Included in block ed6e53dc3515041fd463389e7191fcfac0a3863729ff27ce5eccf03f80381a25',
      parameters: {
        maxFee: 3200,
      },
      fulfillment: {
        BitcoinTxid: '9d48950f168e84944879647ae0cf3d2bda903676528ff3b836ec2540c87c3447',
        BitcoinTxIndex: 2,
        StacksTxid: 'a7f35fc580c10b53816ab656755524ff4007ae52c74c023a93f3ffad38a47234',
        BitcoinBlockHash: '000000000000000000004be6388c1de038390e84305c0bdaa238f8001414cac2',
        BitcoinBlockHeight: 975358,
        BtcFee: 113,
      },
      expectedFulfillmentInfo: {
        bitcoinBlockHeight: 975357,
        bitcoinTxid: '9d48950f168e84944879647ae0cf3d2bda903676528ff3b836ec2540c87c3447',
      },
      txid: '9a45a393a3959e4b54c7c06f21a119ec763e204249c777a90400b7a99ed31d5f',
    },
    acceptTx: {
      tx_id: '0xa7f35fc580c10b53816ab656755524ff4007ae52c74c023a93f3ffad38a47234',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SM37A2MMXMKEHTZ0N6N81TFF4XEA62J2ZR3NM7BW8',
      sponsored: false,
      nonce: 25311,
      fee_rate: '10704',
      block_height: 9458209,
      burn_block_height: 975357,
      tx_result: {
        hex: '0x0703',
        repr: '(ok true)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'accept-withdrawal-request',
        function_signature:
          '(define-public (accept-withdrawal-request (request-id uint) (bitcoin-txid (buff 32)) (signer-bitmap uint) (output-index uint) (fee uint) (burn-hash (buff 32)) (burn-height uint) (sweep-txid (buff 32))))',
        function_args: [
          {
            hex: '0x0100000000000000000000000000001405',
            repr: 'u5125',
            name: 'request-id',
            type: 'uint',
          },
          {
            hex: '0x02000000209d48950f168e84944879647ae0cf3d2bda903676528ff3b836ec2540c87c3447',
            repr: '0x9d48950f168e84944879647ae0cf3d2bda903676528ff3b836ec2540c87c3447',
            name: 'bitcoin-txid',
            type: '(buff 32)',
          },
          {
            hex: '0x0100000000000000000000000000000000',
            repr: 'u0',
            name: 'signer-bitmap',
            type: 'uint',
          },
          {
            hex: '0x0100000000000000000000000000000002',
            repr: 'u2',
            name: 'output-index',
            type: 'uint',
          },
          {
            hex: '0x0100000000000000000000000000000071',
            repr: 'u113',
            name: 'fee',
            type: 'uint',
          },
          {
            hex: '0x0200000020000000000000000000004be6388c1de038390e84305c0bdaa238f8001414cac2',
            repr: '0x000000000000000000004be6388c1de038390e84305c0bdaa238f8001414cac2',
            name: 'burn-hash',
            type: '(buff 32)',
          },
          {
            hex: '0x01000000000000000000000000000ee1fe',
            repr: 'u975358',
            name: 'burn-height',
            type: 'uint',
          },
          {
            hex: '0x02000000209d48950f168e84944879647ae0cf3d2bda903676528ff3b836ec2540c87c3447',
            repr: '0x9d48950f168e84944879647ae0cf3d2bda903676528ff3b836ec2540c87c3447',
            name: 'sweep-txid',
            type: '(buff 32)',
          },
        ],
      },
      post_condition_mode: 'allow',
      post_conditions: [],
      events: [
        {
          event_index: 2,
          event_type: 'smart_contract_log',
          tx_id: '0xa7f35fc580c10b53816ab656755524ff4007ae52c74c023a93f3ffad38a47234',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c000000090c626974636f696e2d7478696402000000209d48950f168e84944879647ae0cf3d2bda903676528ff3b836ec2540c87c3447096275726e2d686173680200000020000000000000000000004be6388c1de038390e84305c0bdaa238f8001414cac20b6275726e2d68656967687401000000000000000000000000000ee1fe0366656501000000000000000000000000000000710c6f75747075742d696e64657801000000000000000000000000000000020a726571756573742d696401000000000000000000000000000014050d7369676e65722d6269746d617001000000000000000000000000000000000a73776565702d7478696402000000209d48950f168e84944879647ae0cf3d2bda903676528ff3b836ec2540c87c344705746f7069630d000000117769746864726177616c2d616363657074',
              repr: '(tuple (bitcoin-txid 0x9d48950f168e84944879647ae0cf3d2bda903676528ff3b836ec2540c87c3447) (burn-hash 0x000000000000000000004be6388c1de038390e84305c0bdaa238f8001414cac2) (burn-height u975358) (fee u113) (output-index u2) (request-id u5125) (signer-bitmap u0) (sweep-txid 0x9d48950f168e84944879647ae0cf3d2bda903676528ff3b836ec2540c87c3447) (topic "withdrawal-accept"))',
            },
          },
        },
      ],
      event_count: 3,
      vm_error: null,
    },
    btcTx: {
      txid: '9d48950f168e84944879647ae0cf3d2bda903676528ff3b836ec2540c87c3447',
      weight: 5255,
      fee: 2543,
      vin: [
        {
          txid: '6f64e4e4c93bb9149e867f2d7dee9f1bd6059d7beabbb28ceafb342b074668bf',
          vout: 0,
        },
        {
          txid: '8a76997c94cc6b57cd79a75019423297b5280054f69ef1917828bfebbfa03203',
          vout: 1,
        },
        {
          txid: '18eb4418f3132526ad2e9c514dcb5074c3834869e7fd38886d4f96456dfa030b',
          vout: 1,
        },
        {
          txid: '924924bf62d1cee6d11b12d627b81654b39c707708d42369973cfd108ab7e534',
          vout: 1,
        },
        {
          txid: 'efa88f095f8c17903aa827c994bd897eab17123abbc7ca51e40e51cd30a0da3d',
          vout: 1,
        },
        {
          txid: 'ab1a26e3c1751308fc0d9b2156f643ff3c1563910377cd0fbfa3773f11139b42',
          vout: 1,
        },
        {
          txid: '83352d0d5dda117d8a2a30c41b6ea7878a4d12cbc3ae9e65c861c48f1ed17a6c',
          vout: 1,
        },
        {
          txid: '97cb355f7f6d38c869e4b43574150215c2f5265fd20fdfedd7d563ae5021709e',
          vout: 1,
        },
        {
          txid: '8d18afa4107217c206745a74680515193f117e60baa278a35e2a590662d5a8ad',
          vout: 1,
        },
        {
          txid: '36e862cd20ee1ed5f1b47f1148889bcbe14bac90adeb07e68c6efb1c6a0c3ade',
          vout: 1,
        },
        {
          txid: '6dda779d6e7b3b211d0427c08dcd2151f6a5bec8923de9adfa5cb48f6a205ffd',
          vout: 1,
        },
      ],
      vout: [
        {
          scriptpubkey: '51208056b53d7e41f8f80b4a2daa457b07f81b1b5f42036152c7d055cd9c7fcdf753',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1psptt20t7g8u0sz629k4y27c8lqd3kh6zqds4937s2hxecl7d7afsrhteyx',
          value: 247844805067,
        },
        {
          scriptpubkey: '6a06543301852800',
          scriptpubkey_type: 'op_return',
          value: 0,
        },
        {
          scriptpubkey: '51202655c5c22e1a2131f92537afd40e04d157f61c8574621d9840780444ba5fc48b',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1pye2uts3wrgsnr7f9x7hagrsy69tlv8y9w33pmxzq0qzyfwjlcj9stegmlw',
          value: 481096960,
        },
      ],
      status: {
        confirmed: true,
        block_height: 975358,
        block_hash: '000000000000000000004be6388c1de038390e84305c0bdaa238f8001414cac2',
        block_time: 1794354030,
      },
    },
    btcTxHex:
      '0200000000010bbf6846072b34fbea8cb2bbea7b9d05d61b9fee7d2d7f869e14b93bc9e4e4646f0000000000000000000332a0bfebbf287891f19ef6540028b59732421950a779cd576bcc947c99768a0100000000000000000b03fa6d45964f6d8838fde7694883c37450cb4d519c2ead262513f31844eb1801000000000000000034e5b78a10fd3c976923d40877709cb35416b827d6121bd1e6ced162bf2449920100000000000000003ddaa030cd510ee451cac7bb3a1217ab7e89bd94c927a83a90178c5f098fa8ef010000000000000000429b13113f77a3bf0fcd77039163153cff43f656219b0dfc081375c1e3261aab0100000000000000006c7ad11e8fc461c8659eaec3cb124d8a87a76e1bc4302a8a7d11da5d0d2d35830100000000000000009e702150ae63d5d7eddf0fd25f26f5c21502157435b4e469c8386d7f5f35cb97010000000000000000ada8d56206592a5ea378a2ba607e113f19150568745a7406c2177210a4af188d010000000000000000de3a0c6a1cfb6e8ce607ebad90ac4be1cb9b8848117fb4f1d51eee20cd62e836010000000000000000fd5f206a8fb45cfaade93d92c8bea5f65121cd8dc027041d213b7b6e9d77da6d01000000000000000003cb99b3b4390000002251208056b53d7e41f8f80b4a2daa457b07f81b1b5f42036152c7d055cd9c7fcdf7530000000000000000086a0654330185280000f5ac1c000000002251202655c5c22e1a2131f92537afd40e04d157f61c8574621d9840780444ba5fc48b0d000040a0291c98349ec32f4c06c636e63228d4d360e599c75376bc26db049beec7dde373448c7ee5498896748306fab0c893088593d311381b075c78d41f1d17255a7e404c315b35dfb1105608421b5f948d5d527d8089a007ef7fb477d384819c1ef14bf0192a93b5aed9ae69add6c0844395e9cab6ee41be7bb28906a59ea5f33f7c9a40205e98533fcc3c31cefb8e7c052b3c3e9ff109fa332b6ce1f27fcb0dfd96fafdab5bda0d87f581ed0b62115a78c9d74d9457412ae68143c2fd77c7431b1ec7600040f960e6153f65bd2a54c616b39fcf1393eabc24af34d170075fa575aa457a9aad797ffbf67eb9f41e721b4a6a83b5b88b0106ae89cb44f6525e2f47f45293d7d14029910952b25b92f9dcbedbfe6d3e9d4a1eadf6e9a5b21d8f638553fe977550bb7ad6ef6997ed332d24bd7a4710c31fb4369a6a05bde2c116581136c348d07706405f9ceaf61da3f4e9d150c999d533d5bc2e08c55a2642c5232148107585258eafc741ef24c78056cf40f27e5d58ffd78e9fc7fb420ca616518de673277747d796401f2f9ba16ae77e8958d129ee2d0fde5173e453a49c22fde804ce8435f673c25c966a82c303d035bc71a7eff4fa585d513b2093d1a92377a8e455af8e2086de92408bfb819314d71e962a143e903d3a6ed64e1cad4a949e6a5d241b4b64d1a68736d68c8c3dc538723c520e0a350b5a81b0d68e68f9d2e90310c658ee98146952b3fd780120045a602c7d83dfd1e7f576f611a26bbf7eae6d6b5f0a022b75684ffe4a8e5432ac201a39d16a6ffaa40fe404e64bc373c47bae126bd3d96dfcac5aa9c2137e089888ba201b6bf6534a8d3176db2e31063db3b1f35221c424306ee9a6b4ac50a46e7ee02eba202772abd64d7d82fa22700ebc9575d69548b699c04201f0d77e8e9602f58d8b64ba204505a302b1e030f1220b4e489c5ee28b855a4060e5a5e13fc739850b413a3121ba207a63f798bdcc5857c12c345f8373ba9167a93f431a3fe8be4fd74f9bbc0076fdba207b3e2369356df5edf768a5218f49c2a1ab871b46550d7ec8156bf2b378b38020ba20852d177ca592ee878b1272d6d166b694d5d419c07508246b07656c22f46b807bba20a3cc2583c4f46a92edace6621fa9dc592dd2fb674d7c5af6e59303f8648bd58eba20ac681c61c24074c42834d798b07d2ab5bdb6da7ea493f25cb3e691ceed663b33ba20ad20fef55bdcb8e14bf9c2de447b20ab36b3cd05261c7fc1e936f94d3514f7d2ba589c21c14a30b2e461b280c0b13a03799096ab1256589153fc4b9c8cead16dc0b64206970341af039ad88c58bd6531bae12c8672c23f1b490f8dca19a945c86653ad0e46c1587e55533a020777bc29632b21e520937e6d98c529022030cbd4b05bf95ba158f301482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403418197eb02b250bec7755b36083636e3556770a4a0d467171675b199c5da337cf23404e64f5d5f356c7e718b0ced48bb2ddb3ce8692b6a97d429c80e87748096b501482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341932ef39fecb36122e112c0a4a8e9c2ca669c65b73f80451fd5a0b4b4ae26169941a643c72c2380bf3aeee871c382e99e6a6506e86c03859f9838071544b501f401482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403416f06399c7d9099e22b20ab5e73fbcbd1ceec286d7c30668fd6f9cffc8be93b6321b4a91f821e349c92881cac871e5457dadd5374b22b63eb1432afe91e83fef201482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341faf1b88f64d745a46082ef00103dfae9319eab762ca81b296dc34e478c1f4c8ea7d69a3daee35679cd4a711831a2b1535bc8b95463567416669619a607efac4c01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403418db514fdd0a689b94b6cfc95ccc96767866e8c354986bddb197a5d3cd23b832bead17dbd94295a941195264b04a4662d828f1a3031ffee34c346f925e80b08a601482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403415fbf3470bade9e81ab933f1c48da38feffe9935a931e2dd4b56cfcb4279ad233575faadcb7de47ef13be9807c11f3cc670ae5d7c7cde6b701a2c706fdec15c2d01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341fa4f253e049b9341befcc1d329bece18128c59e70038ebc9e2bfecb3ed37bbbb1494283cc1940accac105da908e9063f95d8c808df68897cb3c1a425fd742c9701482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403410356102044ba373ed80cff6bcb82f13274c9abf60702cd08eadf48fb04c7b2d683dff5c00f5cf219bd57ad5444e0029074b3027f09765cb340625072db432e2201482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341feffccea0acec206b82f2b2570beb14fa249507245fbf8594866c023e1421ff3fec877fbdd945b67506e9c1202b73ef65a4a02042817cab169ceddaf639b65a101482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361400000000',
  },
  {
    id: 4904,
    outcome: 'accepted',
    kind: 'p2pkh',
    direct: false,
    requestTxid: '510488e4be7eb0bd19545ff883bf3e1f9821ffdfb295b068273cbaf15515b6c8',
    sender: 'SP8HK160YD5GHXP69VGA0TC7AQJ1X4CDW3XVERSE.xverse-signer-manager-2',
    amountSats: 61899,
    maxFeeSats: 10000,
    burnHeight: 974753,
    version: '00',
    hashbytes: '1efbbed4d218b9d8b679201708e21439b2688e7f',
    scriptPubKey: '76a9141efbbed4d218b9d8b679201708e21439b2688e7f88ac',
    address: '13pprLPqrpyKPokskR3xMkHAkqomtYALVw',
    payoutTxid: 'e240cdf2afa6a58faec1ed8b3ab8cba7e5c4fff202425584019d7d7546af23e9',
    payoutVout: 56,
    feeSats: 122,
    acceptTxid: '0132dfc63c0006f6126444626bf497c61edbff41f6137674d13787d19b7ce77a',
    requestTx: {
      tx_id: '0x510488e4be7eb0bd19545ff883bf3e1f9821ffdfb295b068273cbaf15515b6c8',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SPFGAM7AVVF5FTWTMDRV3TRW95K8FJQ5EJ1A2WTD',
      sponsored: false,
      nonce: 2476,
      fee_rate: '226',
      block_height: 9423174,
      burn_block_height: 974753,
      tx_result: {
        hex: '0x0701000000000000000000000000000118db',
        repr: '(ok u71899)',
      },
      contract_call: {
        contract_id: 'SP8HK160YD5GHXP69VGA0TC7AQJ1X4CDW3XVERSE.xverse-signer-manager-2',
        function_name: 'claim-staker-rewards',
        function_signature:
          '(define-public (claim-staker-rewards (staker principal) (reward-cycle uint) (bond-index (optional uint))))',
        function_args: [
          {
            hex: '0x0516cc75f7cbc4fe2a247698c4dd916751c0d91212d2',
            repr: "'SP367BXYBRKZ2M93PK32DV4B7A70DJ4GJTAAYF396",
            name: 'staker',
            type: 'principal',
          },
          {
            hex: '0x0100000000000000000000000000000092',
            repr: 'u146',
            name: 'reward-cycle',
            type: 'uint',
          },
          {
            hex: '0x09',
            repr: 'none',
            name: 'bond-index',
            type: '(optional uint)',
          },
        ],
      },
      post_condition_mode: 'allow',
      post_conditions: [],
      events: [
        {
          event_index: 1,
          event_type: 'fungible_token_asset',
          tx_id: '0x510488e4be7eb0bd19545ff883bf3e1f9821ffdfb295b068273cbaf15515b6c8',
          asset: {
            asset_event_type: 'burn',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token',
            sender: 'SP8HK160YD5GHXP69VGA0TC7AQJ1X4CDW3XVERSE.xverse-signer-manager-2',
            recipient: '',
            amount: '71899',
          },
        },
        {
          event_index: 2,
          event_type: 'fungible_token_asset',
          tx_id: '0x510488e4be7eb0bd19545ff883bf3e1f9821ffdfb295b068273cbaf15515b6c8',
          asset: {
            asset_event_type: 'mint',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token-locked',
            sender: '',
            recipient: 'SP8HK160YD5GHXP69VGA0TC7AQJ1X4CDW3XVERSE.xverse-signer-manager-2',
            amount: '71899',
          },
        },
        {
          event_index: 3,
          event_type: 'smart_contract_log',
          tx_id: '0x510488e4be7eb0bd19545ff883bf3e1f9821ffdfb295b068273cbaf15515b6c8',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c0000000706616d6f756e74010000000000000000000000000000f1cb0c626c6f636b2d68656967687401000000000000000000000000000edfa1076d61782d666565010000000000000000000000000000271009726563697069656e740c000000020968617368627974657302000000141efbbed4d218b9d8b679201708e21439b2688e7f0776657273696f6e0200000001000a726571756573742d696401000000000000000000000000000013280673656e6465720616111984c0f34b08f6c64ee0a0698755e41e918de0177876657273652d7369676e65722d6d616e616765722d3205746f7069630d000000117769746864726177616c2d637265617465',
              repr: '(tuple (amount u61899) (block-height u974753) (max-fee u10000) (recipient (tuple (hashbytes 0x1efbbed4d218b9d8b679201708e21439b2688e7f) (version 0x00))) (request-id u4904) (sender \'SP8HK160YD5GHXP69VGA0TC7AQJ1X4CDW3XVERSE.xverse-signer-manager-2) (topic "withdrawal-create"))',
            },
          },
        },
      ],
      event_count: 5,
      vm_error: null,
    },
    requestRawTx:
      '0x000000000104001f0550eadede57eb9aa371b1eb1c496687cae57400000000000009ac00000000000000e200018c05aaa3d79c6f874272599c8f3609958d20b06ce35a412beaba462bf2b9e7ea3ff7e75b66d110df7a2adc62b2883187d5ec84d2e5971a6851e88538ff8629420301000000000216111984c0f34b08f6c64ee0a0698755e41e918de0177876657273652d7369676e65722d6d616e616765722d3214636c61696d2d7374616b65722d72657761726473000000030516cc75f7cbc4fe2a247698c4dd916751c0d91212d2010000000000000000000000000000009209',
    getWithdrawalRequest:
      '0x0a0c0000000606616d6f756e74010000000000000000000000000000f1cb0c626c6f636b2d68656967687401000000000000000000000000000edfa1076d61782d666565010000000000000000000000000000271009726563697069656e740c000000020968617368627974657302000000141efbbed4d218b9d8b679201708e21439b2688e7f0776657273696f6e0200000001000673656e6465720616111984c0f34b08f6c64ee0a0698755e41e918de0177876657273652d7369676e65722d6d616e616765722d32067374617475730a03',
    getSweepData:
      '0x0a0c000000030f73776565702d6275726e2d6861736802000000200000000000000000000052645299de61c484b658649288d736b9f1bf1b2ece8d1173776565702d6275726e2d68656967687401000000000000000000000000000edfa90a73776565702d747869640200000020e240cdf2afa6a58faec1ed8b3ab8cba7e5c4fff202425584019d7d7546af23e9',
    emily: {
      requestId: 4904,
      stacksBlockHash: 'ab6d8df294564779396814a55721189d1c6957ec574923699e3772c9468533b1',
      stacksBlockHeight: 9423174,
      recipient: '76a9141efbbed4d218b9d8b679201708e21439b2688e7f88ac',
      sender: 'SP8HK160YD5GHXP69VGA0TC7AQJ1X4CDW3XVERSE.xverse-signer-manager-2',
      amount: 61899,
      lastUpdateHeight: 9423854,
      lastUpdateBlockHash: '3fdd792d8a902caa143117126a828ac47dc4a3ce2deeebd822d6aa93656f9bec',
      status: 'confirmed',
      statusMessage:
        'Included in block 3fdd792d8a902caa143117126a828ac47dc4a3ce2deeebd822d6aa93656f9bec',
      parameters: {
        maxFee: 10000,
      },
      fulfillment: {
        BitcoinTxid: 'e240cdf2afa6a58faec1ed8b3ab8cba7e5c4fff202425584019d7d7546af23e9',
        BitcoinTxIndex: 56,
        StacksTxid: '0132dfc63c0006f6126444626bf497c61edbff41f6137674d13787d19b7ce77a',
        BitcoinBlockHash: '0000000000000000000052645299de61c484b658649288d736b9f1bf1b2ece8d',
        BitcoinBlockHeight: 974761,
        BtcFee: 122,
      },
      expectedFulfillmentInfo: {
        bitcoinBlockHeight: 974760,
        bitcoinTxid: 'e240cdf2afa6a58faec1ed8b3ab8cba7e5c4fff202425584019d7d7546af23e9',
      },
      txid: '510488e4be7eb0bd19545ff883bf3e1f9821ffdfb295b068273cbaf15515b6c8',
    },
    acceptTx: {
      tx_id: '0x0132dfc63c0006f6126444626bf497c61edbff41f6137674d13787d19b7ce77a',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SM37A2MMXMKEHTZ0N6N81TFF4XEA62J2ZR3NM7BW8',
      sponsored: false,
      nonce: 21657,
      fee_rate: '949',
      block_height: 9423854,
      burn_block_height: 974761,
      tx_result: {
        hex: '0x0703',
        repr: '(ok true)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'accept-withdrawal-request',
        function_signature:
          '(define-public (accept-withdrawal-request (request-id uint) (bitcoin-txid (buff 32)) (signer-bitmap uint) (output-index uint) (fee uint) (burn-hash (buff 32)) (burn-height uint) (sweep-txid (buff 32))))',
        function_args: [
          {
            hex: '0x0100000000000000000000000000001328',
            repr: 'u4904',
            name: 'request-id',
            type: 'uint',
          },
          {
            hex: '0x0200000020e240cdf2afa6a58faec1ed8b3ab8cba7e5c4fff202425584019d7d7546af23e9',
            repr: '0xe240cdf2afa6a58faec1ed8b3ab8cba7e5c4fff202425584019d7d7546af23e9',
            name: 'bitcoin-txid',
            type: '(buff 32)',
          },
          {
            hex: '0x0100000000000000000000000000000000',
            repr: 'u0',
            name: 'signer-bitmap',
            type: 'uint',
          },
          {
            hex: '0x0100000000000000000000000000000038',
            repr: 'u56',
            name: 'output-index',
            type: 'uint',
          },
          {
            hex: '0x010000000000000000000000000000007a',
            repr: 'u122',
            name: 'fee',
            type: 'uint',
          },
          {
            hex: '0x02000000200000000000000000000052645299de61c484b658649288d736b9f1bf1b2ece8d',
            repr: '0x0000000000000000000052645299de61c484b658649288d736b9f1bf1b2ece8d',
            name: 'burn-hash',
            type: '(buff 32)',
          },
          {
            hex: '0x01000000000000000000000000000edfa9',
            repr: 'u974761',
            name: 'burn-height',
            type: 'uint',
          },
          {
            hex: '0x0200000020e240cdf2afa6a58faec1ed8b3ab8cba7e5c4fff202425584019d7d7546af23e9',
            repr: '0xe240cdf2afa6a58faec1ed8b3ab8cba7e5c4fff202425584019d7d7546af23e9',
            name: 'sweep-txid',
            type: '(buff 32)',
          },
        ],
      },
      post_condition_mode: 'allow',
      post_conditions: [],
      events: [
        {
          event_index: 2,
          event_type: 'smart_contract_log',
          tx_id: '0x0132dfc63c0006f6126444626bf497c61edbff41f6137674d13787d19b7ce77a',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c000000090c626974636f696e2d747869640200000020e240cdf2afa6a58faec1ed8b3ab8cba7e5c4fff202425584019d7d7546af23e9096275726e2d6861736802000000200000000000000000000052645299de61c484b658649288d736b9f1bf1b2ece8d0b6275726e2d68656967687401000000000000000000000000000edfa903666565010000000000000000000000000000007a0c6f75747075742d696e64657801000000000000000000000000000000380a726571756573742d696401000000000000000000000000000013280d7369676e65722d6269746d617001000000000000000000000000000000000a73776565702d747869640200000020e240cdf2afa6a58faec1ed8b3ab8cba7e5c4fff202425584019d7d7546af23e905746f7069630d000000117769746864726177616c2d616363657074',
              repr: '(tuple (bitcoin-txid 0xe240cdf2afa6a58faec1ed8b3ab8cba7e5c4fff202425584019d7d7546af23e9) (burn-hash 0x0000000000000000000052645299de61c484b658649288d736b9f1bf1b2ece8d) (burn-height u974761) (fee u122) (output-index u56) (request-id u4904) (signer-bitmap u0) (sweep-txid 0xe240cdf2afa6a58faec1ed8b3ab8cba7e5c4fff202425584019d7d7546af23e9) (topic "withdrawal-accept"))',
            },
          },
        },
      ],
      event_count: 3,
      vm_error: null,
    },
    btcTx: {
      txid: 'e240cdf2afa6a58faec1ed8b3ab8cba7e5c4fff202425584019d7d7546af23e9',
      weight: 20599,
      fee: 17083,
      vin: [
        {
          txid: '98649f4892eef9c8f2db831e9b652617301d5626fdc4d49a989f4a94a50d9652',
          vout: 0,
        },
        {
          txid: '48bb911fa4740e396168621287311473a97aab8ebe5bc52dad00b9f6ac7d5d19',
          vout: 1,
        },
        {
          txid: 'd8e77401c8cb01b5d8c739db2cb66a360e012129e44a6034d5dc5cf715119451',
          vout: 1,
        },
        {
          txid: '02b0de7184daf3f675be6516e6c970e51f446d105b29204290de00e63a1a3768',
          vout: 1,
        },
        {
          txid: 'c27d5151feb8b54e6f234de5e2a56b8377fcb9f5405a644fd5a9e88c9defc269',
          vout: 1,
        },
        {
          txid: '68396f263e541427740c12d5f4d6f07c6e1ecea668834f5bfe6a0d1b27a80391',
          vout: 1,
        },
        {
          txid: '6f10a38b25a319aca5afe274f60fc8af619e30ca9b778cc4711ad55d36f7b59c',
          vout: 1,
        },
        {
          txid: '2dfbabf58ba9a4c68cf80e14a551bb78f451902535f62b6695fab96635c5dcb3',
          vout: 1,
        },
        {
          txid: '7f98b68c0f1657aa03d6e8528098622991910a6e198b45de25715e9f051d3dbd',
          vout: 1,
        },
        {
          txid: 'e7d1b8e2f57c5510deb30ae12faf37925830934047f0132a8191581c7e86d6c7',
          vout: 1,
        },
        {
          txid: '81b9894b81d90d2cbe09bac5f9bc535c092ef02d40f09a523835dd3eeb7035de',
          vout: 1,
        },
      ],
      vout: [
        {
          scriptpubkey: '51208056b53d7e41f8f80b4a2daa457b07f81b1b5f42036152c7d055cd9c7fcdf753',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1psptt20t7g8u0sz629k4y27c8lqd3kh6zqds4937s2hxecl7d7afsrhteyx',
          value: 248164733976,
        },
        {
          scriptpubkey: '6a18543301e82512f3b7dd7ff7f9ffff42fcffffffffffffff01',
          scriptpubkey_type: 'op_return',
          value: 0,
        },
        {
          scriptpubkey: 'a914f43b34cb08917d577b40ea9b676a7e07e1d5bb9187',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3PxPj54fagJnM29uW9VHGYTBRnjnkCrj6U',
          value: 56972,
        },
        {
          scriptpubkey: 'a9148955b4665cc0931f8200e11d094577e10e95bc1787',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3EDBAh1K7JJYM5QDDjCHFd63CX7Mtu24ER',
          value: 93135,
        },
        {
          scriptpubkey: 'a9143763a274bdcdb858bb576364539cf63a8b5f4ff887',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '36jtSpwXUvFmGRWcmvCe3VCTpqhWiZ4XDG',
          value: 115637,
        },
        {
          scriptpubkey: '00147d43d4c84db2492c321735f3ec60dcae5b92b728',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q04pafjzdkfyjcvshxhe7ccxu4ede9degdx785l',
          value: 62101,
        },
        {
          scriptpubkey: '0014e1813e8dd5040115d189675b035c7412ef347f30',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1quxqnarw4qsq3t5vfvadsxhr5zthngleshx53x7',
          value: 131434,
        },
        {
          scriptpubkey: 'a914da58f1d138c69dace999c8903da1c29f15754c2087',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3MbXnLnE4Ks9jTr3epgZbwFnCt5shfFcMv',
          value: 98492,
        },
        {
          scriptpubkey: '001434058c7036d86d0ddf92dbd573889c88727d385e',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qxszccupkmpksmhujm02h8zyu3pe86wz74a5k56',
          value: 91054,
        },
        {
          scriptpubkey: '0014163413c00f48fd0e102cadba34de037e7944bcb4',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qzc6p8sq0fr7suypv4karfhsr0eu5f095ppd3zy',
          value: 395875,
        },
        {
          scriptpubkey: '00146af279862fccad8ea11e21eb154e2abf688b9ead',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qdte8np30ejkcagg7y8432n32ha5gh84dmu5rwa',
          value: 243817,
        },
        {
          scriptpubkey: 'a9148becb0af77b7f0c2becfefe15ededa5982ba48ba87',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3ESsPjJ37D6kZD44ftc2ueMAAv83UbvHGJ',
          value: 190388,
        },
        {
          scriptpubkey: '00147cfa1a8d9d547363f0781542fc4be1db61e7a28e',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q0nap4rva23ek8urcz4p0cjlpmds70g5w5784ql',
          value: 199974,
        },
        {
          scriptpubkey: 'a914952808454e0b479d653c6234e0fe4478bc52c22987',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3FHgZcurCA9B6EMxHuHpoVtCfDDQCKqWYT',
          value: 1463291,
        },
        {
          scriptpubkey: '0014d87b908160cb1b64c6a38641ce278e0aa3a7fb11',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qmpaepqtqevdkf34rsequufuwp23607c38w83te',
          value: 659709,
        },
        {
          scriptpubkey: 'a91471de3ac2ac703cb6aff0c47b69368d7a93c16ee587',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3C56VzugyBpUkxWomafnid8t2NyaKUtwCH',
          value: 67284,
        },
        {
          scriptpubkey: 'a914b64247801e4a1517b2470e82bb8b3efebbe7eb6387',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3JJiJd72HHxTgWUCS1WzCYh8dgiuCsazqn',
          value: 56971,
        },
        {
          scriptpubkey: 'a9148ca0e55e74060d55fd5e6599cd64057dc487183e87',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3EWbGeYgkbwRwySzSPqzBfWFhRQ6X3Kimk',
          value: 382351,
        },
        {
          scriptpubkey: '00144f6f359dd92a2725cbae6103da28b5b0bf5a8ce5',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qfahnt8we9gnjtjawvypa5294kzl44r89uxww5x',
          value: 190918,
        },
        {
          scriptpubkey: 'a914f019578b3d680af8daa0ab8130fcd19e30a7bce687',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3PaYTNe1PLBDbGu77ZVSyhpHkSkCQFgZ6h',
          value: 81079,
        },
        {
          scriptpubkey: '00148b695f57683d87e2b3e905148408c35dc8154adf',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q3d5474mg8kr79vlfq52ggzxrthyp2jklwh7xgl',
          value: 382447,
        },
        {
          scriptpubkey: 'a9149d31d0821b40ce45db976353521a1181b26ae2d887',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3G2BgqDvY4nD6PZrTuDRJgteZMHzcXKGiq',
          value: 61551,
        },
        {
          scriptpubkey: '001422915523266eee7e487a6a9dd807e23a779224f6',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qy2g42gexdmh8ujr6d2wasplz8fmeyf8khegumu',
          value: 1871,
        },
        {
          scriptpubkey: '001407b32f4255fcff165144104611479a893b32b282',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qq7ej7sj4lnl3v52yzprpz3u63yan9v5z2vmxn8',
          value: 56971,
        },
        {
          scriptpubkey: 'a914c78fc6c6c009898adb68b1fc692c8f773c8dbef287',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3KtCdUvfshNSQLXj33Jvy9qGDGAzfS5SDd',
          value: 123941,
        },
        {
          scriptpubkey: 'a914c3069817cacf1266e4adcd409dc14e152738d45887',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3KUDb7nAm18DecTKn9Ugvd4HCXWrpBHp7V',
          value: 56971,
        },
        {
          scriptpubkey: '001463ec8808122d5913aede7aa5572c2ffb71717266',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qv0kgszqj94v38tk702j4wtp0ldchzunxzzn3vx',
          value: 37967173,
        },
        {
          scriptpubkey: 'a91473207672aa47085828d077f6f7aa9399c63b202187',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3CBkX9jDfJPPaQay5hbJb9uwhxd7pKbt4B',
          value: 70230,
        },
        {
          scriptpubkey: '00143c3edf0ffd439453bc74415e8bf0a23b82a45d0b',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q8sld7rlagw2980r5g90ghu9z8wp2ghgtks3n68',
          value: 1329407,
        },
        {
          scriptpubkey: 'a91413e0c3750ccbc1ed185f1ccb54f1036079ca1dfa87',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '33W822jHDSYPEZZTHYD7ZPFz1BBLoma5aL',
          value: 579339,
        },
        {
          scriptpubkey: 'a914becf2a22f158b19dc8f0b0af6c807a1fa9bc1d2a87',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3K5vV3GmTt7Tf14k88m893acgwwNiJ9efB',
          value: 93804,
        },
        {
          scriptpubkey: '001456af4433fda2cfc058e3b0d6f8094199c7cada7e',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q26h5gvla5t8uqk8rkrt0sz2pn8ru4kn7k5fcjd',
          value: 58176,
        },
        {
          scriptpubkey: '00142c4d1154deafd4b291838a6e0a3e7bb6908028ed',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q93x3z4x74l2t9yvr3fhq50nmk6ggq28dxmgavh',
          value: 73094,
        },
        {
          scriptpubkey: '0014e472e06817776da9c0bfa21fe943a4d1af55142e',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qu3ewq6qhwak6ns9l5g07jsay6xh429pwxx30jy',
          value: 83423,
        },
        {
          scriptpubkey: '0014da8a70ea2acddd969b5ecaf123ee1cfeec925158',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qm298p632ehwedx67etcj8msulmkfy52cl2l5aw',
          value: 71148,
        },
        {
          scriptpubkey: 'a9147236a47bca35cce334037c4fe73e1e0cb683fee087',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3C6vR3Kf8oA8Y4vbQEFjeNuVYo1oDmoZ52',
          value: 123941,
        },
        {
          scriptpubkey: '0014ac63400a767632822ea045fef504dcf7440ac6f4',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q4335qznkwcegyt4qghl02pxu7azq43h5vxpxpk',
          value: 192251,
        },
        {
          scriptpubkey: 'a9148baf75a2019d970ece78c83babbccea75ddd894787',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3ERc3M9aZVeQWnCq8rbFQqUiSejhrqcdtN',
          value: 125280,
        },
        {
          scriptpubkey: 'a914f4c4dcd2c1df9831d24d489a705e1a1f8a8919af87',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3Q1EdbvhqNGjeC6G95JwRd2s2LXTNhfLvh',
          value: 209268,
        },
        {
          scriptpubkey: 'a9142f59f6a544f5d742c2bd3d5f3d1770ab492be20187',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '361PTL88373TLKCfhzUk4QEp6ZuB748vWq',
          value: 75569,
        },
        {
          scriptpubkey: '0014855f20eede048dd5623e04dcbc4bb4d81423cec0',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qs40jpmk7qjxa2c37qnwtcja5mq2z8nkqf945qh',
          value: 97152,
        },
        {
          scriptpubkey: '001450a019e898194115306fa470bf1ae756aac85d09',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q2zspn6ycr9q32vr053ct7xh8264vshgfxk2auh',
          value: 1106295,
        },
        {
          scriptpubkey: '00147daab45106f05beb0f64660ffb7aa9db48c236c3',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q0k4tg5gx7pd7krmyvc8lk74fmdyvydkrqksa6r',
          value: 57714,
        },
        {
          scriptpubkey: '0014ab0952fa9c7f4afaa8ee576e9320d3d776c2c1aa',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q4vy4975u0a90428w2ahfxgxn6amv9sd2akrqmp',
          value: 81059,
        },
        {
          scriptpubkey: 'a914f83d66314bc435983b733ba8193dc0686e401d1c87',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3QKb4D2bZBqGLqZXsifhNPFMbZEjVowUbb',
          value: 73220,
        },
        {
          scriptpubkey: '0014d5ab6a142b32328bcfaa70ca3ef2106606828538',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q6k4k59ptxgeghna2wr9raussvcrg9pfctwecfw',
          value: 451824,
        },
        {
          scriptpubkey: '00147c5b81b7bdd53d87106f2d1812f17de906f7de52',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q03dcrdaa657cwyr095vp9utaayr00hjjzvsuf5',
          value: 58979,
        },
        {
          scriptpubkey: 'a9145b989f2f378659de64d3c43b6ce197097b86c0f187',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3A3LFMFFd8AEt8ZUDY68T9wFajNCkeTmJv',
          value: 1369382,
        },
        {
          scriptpubkey: '0014892a3f2788339923a11166ab9c6f867b97c41a6c',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q3y4r7fugxwvj8gg3v64ecmux0wtugxnvs86f9u',
          value: 123817,
        },
        {
          scriptpubkey: 'a9141076bd4802347d296b12b19d05b3143d17b5c5c987',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '33C4ymbrf1CCX7qo3a4qRmCmKaPtDdKc9K',
          value: 67183,
        },
        {
          scriptpubkey: 'a9144bcff10649bb6943774a3347109854dd394b783a87',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '38bshxdMTSj38sYNiMDepbjZ5HW2ZreGcT',
          value: 65825,
        },
        {
          scriptpubkey: 'a91432532608301b8832a7717537dce6b70dae314c9687',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '36H7KQ5PyMyHYhXTr8u2G9aZspya27NCbS',
          value: 1101306,
        },
        {
          scriptpubkey: 'a9144e25d6a808eaf9c0ea28ccdb10e0689dd328fabf87',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '38pDxa7TZjQei3c2PwFsVJEJLFLQDd3kNo',
          value: 123941,
        },
        {
          scriptpubkey: '0014ed148831faabb7cd6f58bb23f339e08ac827d8f9',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qa52gsv064wmu6m6chv3lxw0q3tyz0k8euctmkx',
          value: 250361,
        },
        {
          scriptpubkey: 'a91484cfcd4db8006c825011a4b75a066a2d18f4d4ad87',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3DoG4CWFbpqRmdMhvpVvrFwaEbE1Dkz6q7',
          value: 60756,
        },
        {
          scriptpubkey: '0014e3d0ab5eecff5f4232da6c6bf0300be4dc08d245',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qu0g2khhvla05yvk6d34lqvqtunwq35j9yjps82',
          value: 115905,
        },
        {
          scriptpubkey: '76a9141efbbed4d218b9d8b679201708e21439b2688e7f88ac',
          scriptpubkey_type: 'p2pkh',
          scriptpubkey_address: '13pprLPqrpyKPokskR3xMkHAkqomtYALVw',
          value: 61899,
        },
        {
          scriptpubkey: '0014ea2274d6a17e126b41cd66edb354b6d017e9cb62',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qag38f44p0cfxkswdvmkmx49k6qt7njmz4tmyet',
          value: 56971,
        },
        {
          scriptpubkey: 'a9144b117f5e443a8e3417684d92299e7242ed4a436287',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '38XwZgSjve8aiDXuQdC22uvJKRSeH7SJvy',
          value: 97970,
        },
        {
          scriptpubkey: 'a914ade6a28bcf74a8d546fda3df2fb948e4fc0a240187',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3HYX7XYP8qoMeReStmSpC15MCMXpnCXX6k',
          value: 713280,
        },
        {
          scriptpubkey: 'a914573d29c4035daa68c158beb9c9516722d8c3e33687',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '39eHyvV7ndBm4Lx6Wtn2PiPf68ehb2g2U9',
          value: 62730,
        },
        {
          scriptpubkey: '0014eb78daf00a708d394b7091678309d1247477c5f2',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qadud4uq2wzxnjjmsj9ncxzw3y368030jds59f4',
          value: 1329407,
        },
        {
          scriptpubkey: '0014f2c08bb331a10a4ac538e7219b04cf8157ea2a0f',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q7tqghve35y9y43fcuusekpx0s9t752s0kmhaex',
          value: 483096,
        },
        {
          scriptpubkey: '0014113b5269d44b1f50250a4d994c58e29ca3dec67c',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qzya4y6w5fv04qfg2fkv5ck8znj3aa3nu409ask',
          value: 126543,
        },
        {
          scriptpubkey: 'a9145960a87c9843e9b6e82b4eef90bf4883e48a727187',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '39qbrYS3BQXcw13pa3sGz9j6ibiCDHqngH',
          value: 123941,
        },
        {
          scriptpubkey: '0014fa6f791cc49a2e0937ce1032bc2b932d13c4da03',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qlfhhj8xynghqjd7wzqetc2un95fufksrl5xcep',
          value: 79727,
        },
        {
          scriptpubkey: '0014f7410bf47b5c5eb5e46f6576c8d30b76a0038265',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q7aqsharmt30tter0v4mv35ctw6sq8qn9u9c5he',
          value: 56971,
        },
        {
          scriptpubkey: 'a9148312854e78b88e26b7d44d5c880486c54a85c43587',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3De4dWuAeshXZE9T2Q28MQFYVd3zbE2EBy',
          value: 123941,
        },
        {
          scriptpubkey: '0014c6d4960f25427cb935856e9af904c51d8e4821f6',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qcm2fvre9gf7tjdv9d6d0jpx9rk8ysg0k9l0t2c',
          value: 120063,
        },
        {
          scriptpubkey: '0014858e155704971798ae93f6ffb88b75cd3990a73e',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qsk8p24cyjute3t5n7mlm3zm4e5uepfe7nync5a',
          value: 252222,
        },
        {
          scriptpubkey: '00142fb06114be52da83a12c5ad1a84ac41d57467d6d',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q97cxz9972tdg8gfvttg6sjkyr4t5vltdnl6fru',
          value: 212181,
        },
        {
          scriptpubkey: 'a9143e029801a803eabfd447759518c114cac9e2468887',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '37LtvezieLrdBxEtDvTXF6H3FZxTita7Go',
          value: 57667,
        },
        {
          scriptpubkey: '00148ae58e30d9cc388794fd95169746a4229186050c',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q3tjcuvxeesug098aj5tfw34yy2gcvpgv34slud',
          value: 251228,
        },
        {
          scriptpubkey: '0014c7607274e0a2efff79d12a51326dad53d42dcbda',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qcas8ya8q5thl77w39fgnymdd202zmj76j693aq',
          value: 214695,
        },
        {
          scriptpubkey: '0014b01b6d2d7a7311b8196830b46fcb275f25f138cf',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qkqdk6tt6wvgmsxtgxz6xlje8tujlzwx0wmk7vp',
          value: 168141,
        },
        {
          scriptpubkey: '001410e02fd7afa8f603fb0859f5c80094e768c82c21',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qzrszl4a04rmq87cgt86usqy5ua5vstppcg8lgq',
          value: 56971,
        },
        {
          scriptpubkey: 'a914fe5580c031f89297809937ab06a66559b946161787',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3Qsoz7iUB2Hj5rdn2id2srRy2cYsQneeEr',
          value: 139478,
        },
        {
          scriptpubkey: 'a914332ceb63a262d636eb9e8d9b411e021dcd461add87',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '36McCPTDYdNVjqthgMpj2npn2oNznMKjfX',
          value: 102845,
        },
        {
          scriptpubkey: '00140745f55771891369f32e9bae2ca8ede2daeaf1ac',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qqazl24m33yfknuewnwhze28dutdw4udv980xp3',
          value: 91708,
        },
        {
          scriptpubkey: '0014a757a1fe3dcd3910404d18949050e5e42ade5e4f',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q5at6rl3ae5u3qszdrz2fq589us4duhj0mjkre4',
          value: 77517,
        },
        {
          scriptpubkey: 'a914a205793936aeaa31c2b33f42f82da7bb35bc2ca987',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3GThwvmFASGveVgYsmnWFhcCbL5dXyjsZZ',
          value: 130640,
        },
        {
          scriptpubkey: '00145aea1443f4b72d8dc34641fdd6fa94e5573ed931',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qtt4pgsl5kukcms6xg87ad755u4tnakf3kl5h0k',
          value: 123941,
        },
        {
          scriptpubkey: '0014d36c52f9ae83b92557719898888feff5054a16e2',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q6dk997dwswuj24m3nzvg3rl075z559hzjykxja',
          value: 70364,
        },
        {
          scriptpubkey: 'a9140689d52e056fc0b21e3e17ab10325abb672c3aa587',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '32Hb6UrAvFM1cjdswt7ZAZjsR5VCTZ9CCS',
          value: 130280,
        },
        {
          scriptpubkey: 'a914818d3d6a00616ef90c10443db3b1ea10215dfff387',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3DW2HowNUJ1vLk2a1uwLG2HU9rH9Byrsbj',
          value: 70110,
        },
        {
          scriptpubkey: '0014712126bbd5ec823d6269c5f9f71e48a85fc22dc0',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qwysjdw74ajpr6cnfchulw8jg4p0uytwq3cag46',
          value: 96215,
        },
        {
          scriptpubkey: '0014b95ebab06be0dfe863870fb15d0a7e85afcf6e4e',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qh90t4vrtur07scu8p7c46zn7skhu7mjw5aqrjh',
          value: 1495999,
        },
        {
          scriptpubkey: '0014d193cf75756a75c27c39b750a080b3e8d8d14639',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q6xfu7at4df6uylpekag2pq9narvdz33etsztut',
          value: 294999,
        },
        {
          scriptpubkey: '0014b4c3fa8d89cfa2c2c40f0d2fcc773aa4107e4337',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qknpl4rvfe73v93q0p5hucae65sg8usehfyudhs',
          value: 999,
        },
        {
          scriptpubkey: '512094b051fcb10b4fe6ee15a9fe6a94996f692281576569340f2946670b0d1be7f3',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1pjjc9rl93pd87dms448lx49yeda5j9q2hv45ngrefgenskrgmulesl054mz',
          value: 10116330,
        },
        {
          scriptpubkey: '5120e805065e5c3a2d4323af4300670ea1bde22948c931522e35819da7fd500adae4',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1paqzsvhju8gk5xga0gvqxwr4phh3zjjxfx9fzudvpnknl65q2mtjqa49lkt',
          value: 4230939,
        },
        {
          scriptpubkey: '5120117b66a236c7a6f36aad42f61324bdd70d00cc7c1c505e672ff6671c735511e0',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1pz9akdg3kc7n0x64dgtmpxf9a6uxspnrur3g9uee07en3cu64z8sqhmmxqz',
          value: 13489789,
        },
        {
          scriptpubkey: '512065e1faa4395a41aafb5fafe731bca629832b0958db7403e2d5e83851636c3e2f',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1pvhsl4fpetfq6476l4lnnr09x9xpjkz2cmd6q8ck4aqu9zcmv8chszx9y3a',
          value: 6742886,
        },
        {
          scriptpubkey: '512079f3ab6642bfa650f6bef529397015048ab035432dec22c2f91cc8f22c064c60',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1p08e6kejzh7n9pa47755njuq4qj9tqd2r9hkz9sherny0ytqxf3sqwrd7ch',
          value: 13489773,
        },
        {
          scriptpubkey: '0014bfbe2519577edf8c056e0b1c697dc81af219fbab',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qh7lz2x2h0m0ccptwpvwxjlwgrtepn7atnswup6',
          value: 398000,
        },
        {
          scriptpubkey: '00144f760137345b36674177794f44d8555165c6ec3d',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qfamqzde5tvmxwsth0985fkz429judmpawxjlp0',
          value: 398000,
        },
        {
          scriptpubkey: '00142a6d234605e24457dab21236db0be45a9577ac31',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q9fkjx3s9ufz90k4jzgmdkzlyt22h0tp3x92ua9',
          value: 398000,
        },
        {
          scriptpubkey: '001406963cb167387f7424b48f6a87a52964483ecbaa',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qq6trevt88plhgf953a4g0fffv3yraja2a50h5k',
          value: 197000,
        },
        {
          scriptpubkey: '0014a00e78303167784d11637b045c002806a30f870f',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q5q88svp3vauy6ytr0vz9cqpgq63slpc0v3t955',
          value: 197000,
        },
        {
          scriptpubkey: '00143fd0dd24a595eb1c60815afc50bd2a6f3a35d63e',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q8lgd6f99jh43ccyptt79p0f2duart437zu7scn',
          value: 2343916,
        },
        {
          scriptpubkey: '5120c1a600ff7ffe619c912f8d0e23a23d2bc7bbcdc43bf7804ff902be30a3ba2128',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1pcxnqplmlleseeyf0358z8g3a90rmhnwy80mcqnleq2lrpga6yy5q643yy4',
          value: 3172069,
        },
        {
          scriptpubkey: '001421b0caa3c71f1646667313b4aafac1b8f42a2f40',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qyxcv4g78rutyvennzw6247kphr6z5t6qc08yju',
          value: 1601759,
        },
        {
          scriptpubkey: '5120d8145230061801d23e2349641997424927c98a7e8085c7cabd35b9a388079753',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1pmq29yvqxrqqay03rf9jpn96zfynunzn7szzu0j4axku68zq8jafsk6m6n7',
          value: 11273003,
        },
        {
          scriptpubkey: '00141b9c186755da26bf7d50edfc19d2d7acc01f251f',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qrwwpse64mgnt7l2sah7pn5kh4nqp7fglya3c3j',
          value: 8429608,
        },
        {
          scriptpubkey: '51203234fefe2e8f13fa578fec5916a75bde49a4a555888240390a46ab6592bf9d9e',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1pxg60al3w3ufl54u0a3v3df6mmey6ff243zpyqwg2g64kty4lnk0quxrhcu',
          value: 9038690,
        },
        {
          scriptpubkey: '0014891354778f79a4f6e86445a6ac9523be4010db32',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q3yf4gau00xj0d6rygkn2e9frheqppkejqdu7yf',
          value: 2262953,
        },
        {
          scriptpubkey: '0014e7914025d712bf175675aa9e8c910e11e54fecf9',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qu7g5qfwhz2l3w4n4420geygwz8j5lm8e7r9s3w',
          value: 2141510,
        },
        {
          scriptpubkey: '00149dd6706b6c2c592a935ae59b7ae0864ee0b81592',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qnht8q6mv93vj4y66ukdh4cyxfmsts9vjk20q88',
          value: 264519,
        },
        {
          scriptpubkey: '001405537517aee02812be1b08fd60f120b929c28471',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qq4fh29awuq5p90smpr7kpufqhy5u9pr3tn9jth',
          value: 1446580,
        },
        {
          scriptpubkey: 'a91478c48d24c33cd40ea4aad9c60f67baa59dd3e3f587',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3ChaUByg16RdPaRKt1HbAJo3BvvMHH6YrH',
          value: 228475,
        },
        {
          scriptpubkey: '00140eaf58bdd38331446eb14216a53151eea12578c5',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qp6h430wnsvc5gm43ggt22v23a6sj27x930kmdw',
          value: 485581,
        },
        {
          scriptpubkey: 'a91417a998607137530f4e647810f355998043a1174087',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '33r8ddywJe3LZUDsJ2EzwZTpmjoWa5kpe1',
          value: 56977,
        },
        {
          scriptpubkey: '0014a553e8cbeeb69f2b12faea784ded53100f2a7307',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q54f73jlwk60jkyh6afuymm2nzq8j5uc8c5esvy',
          value: 154078,
        },
        {
          scriptpubkey: '00148a8fd1315a361349c398eff4931b2172966d51b4',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q328azv26xcf5nsucal6fxxepw2tx65d52m063w',
          value: 135859,
        },
        {
          scriptpubkey: '00144d0c55e1f2a1c2b7a8614e18bf819b46210d55ea',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qf5x9tc0j58pt02rpfcvtlqvmgcss6402d3l598',
          value: 549471,
        },
        {
          scriptpubkey: '0014933884af32d951784d77f12ff5b9105ff3005413',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qjvugftejm9ghsnth7yhltwgstlesq4qnk7p975',
          value: 110548,
        },
        {
          scriptpubkey: '001467f1168b7c689b69834d6fffffd511a1da9bb717',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qvlc3dzmudzdknq6ddllll4g358dfhdchxt95sm',
          value: 5347629,
        },
        {
          scriptpubkey: 'a9147601f415f2833ef0aa3ff9ee0e72cb08493b71e887',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3CSyzueW1zQKKAMz3bLZBRPUnTggeVnRTC',
          value: 57774,
        },
        {
          scriptpubkey: '0014a333bdb2ba386a45c6e75dadc3292285a783d9ff',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q5vemmv468p4yt3h8tkkux2fzsknc8k0lcx45k3',
          value: 1058847,
        },
        {
          scriptpubkey: '0014a1255ff1c799c053579058865e60e1fa1bc3a5b6',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q5yj4luw8n8q9x4ustzr9uc8plgdu8fdk9rdrrw',
          value: 119922,
        },
        {
          scriptpubkey: 'a914e451725b7f869ed4193a5a1d965c898bdf1aa3c087',
          scriptpubkey_type: 'p2sh',
          scriptpubkey_address: '3NWFZJDS4rDzy5xJgqFCcg3QGKQjnQktMN',
          value: 175284,
        },
        {
          scriptpubkey: '00149a85d4576ddbf45c67ec0cc44f2ae711471683e2',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qn2zag4mdm069celvpnzy72h8z9r3dqlz6hwrl3',
          value: 224397,
        },
      ],
      status: {
        confirmed: true,
        block_height: 974761,
        block_hash: '0000000000000000000052645299de61c484b658649288d736b9f1bf1b2ece8d',
        block_time: 1793940446,
      },
    },
    btcTxHex:
      '0200000000010b52960da5944a9f989ad4c4fd26561d301726659b1e83dbf2c8f9ee92489f6498000000000000000000195d7dacf6b900ad2dc55bbe8eab7aa97314318712626861390e74a41f91bb4801000000000000000051941115f75cdcd534604ae42921010e366ab62cdb39c7d8b501cbc80174e7d801000000000000000068371a3ae600de904220295b106d441fe570c9e61665be75f6f3da8471deb00201000000000000000069c2ef9d8ce8a9d54f645a40f5b9fc77836ba5e2e54d236f4eb5b8fe51517dc20100000000000000009103a8271b0d6afe5b4f8368a6ce1e6e7cf0d6f4d5120c742714543e266f39680100000000000000009cb5f7365dd51a71c48c779bca309e61afc80ff674e2afa5ac19a3258ba3106f010000000000000000b3dcc53566b9fa95662bf635259051f478bb51a5140ef88cc6a4a98bf5abfb2d010000000000000000bd3d1d059f5e7125de458b196e0a91912962988052e8d603aa57160f8cb6987f010000000000000000c7d6867e1c5891812a13f047409330589237af2fe10ab3de10557cf5e2b8d1e7010000000000000000de3570eb3edd3538529af0402df02e095c53bcf9c5ba09be2c0dd9814b89b9810100000000000000007a1854c5c7390000002251208056b53d7e41f8f80b4a2daa457b07f81b1b5f42036152c7d055cd9c7fcdf75300000000000000001a6a18543301e82512f3b7dd7ff7f9ffff42fcffffffffffffff018cde00000000000017a914f43b34cb08917d577b40ea9b676a7e07e1d5bb9187cf6b01000000000017a9148955b4665cc0931f8200e11d094577e10e95bc1787b5c301000000000017a9143763a274bdcdb858bb576364539cf63a8b5f4ff88795f20000000000001600147d43d4c84db2492c321735f3ec60dcae5b92b7286a01020000000000160014e1813e8dd5040115d189675b035c7412ef347f30bc8001000000000017a914da58f1d138c69dace999c8903da1c29f15754c2087ae6301000000000016001434058c7036d86d0ddf92dbd573889c88727d385e630a060000000000160014163413c00f48fd0e102cadba34de037e7944bcb469b80300000000001600146af279862fccad8ea11e21eb154e2abf688b9eadb4e702000000000017a9148becb0af77b7f0c2becfefe15ededa5982ba48ba87260d0300000000001600147cfa1a8d9d547363f0781542fc4be1db61e7a28efb5316000000000017a914952808454e0b479d653c6234e0fe4478bc52c22987fd100a0000000000160014d87b908160cb1b64c6a38641ce278e0aa3a7fb11d40601000000000017a91471de3ac2ac703cb6aff0c47b69368d7a93c16ee5878bde00000000000017a914b64247801e4a1517b2470e82bb8b3efebbe7eb63878fd505000000000017a9148ca0e55e74060d55fd5e6599cd64057dc487183e87c6e90200000000001600144f6f359dd92a2725cbae6103da28b5b0bf5a8ce5b73c01000000000017a914f019578b3d680af8daa0ab8130fcd19e30a7bce687efd50500000000001600148b695f57683d87e2b3e905148408c35dc8154adf6ff000000000000017a9149d31d0821b40ce45db976353521a1181b26ae2d8874f0700000000000016001422915523266eee7e487a6a9dd807e23a779224f68bde00000000000016001407b32f4255fcff165144104611479a893b32b28225e401000000000017a914c78fc6c6c009898adb68b1fc692c8f773c8dbef2878bde00000000000017a914c3069817cacf1266e4adcd409dc14e152738d45887455543020000000016001463ec8808122d5913aede7aa5572c2ffb71717266561201000000000017a91473207672aa47085828d077f6f7aa9399c63b202187ff481400000000001600143c3edf0ffd439453bc74415e8bf0a23b82a45d0b0bd708000000000017a91413e0c3750ccbc1ed185f1ccb54f1036079ca1dfa876c6e01000000000017a914becf2a22f158b19dc8f0b0af6c807a1fa9bc1d2a8740e300000000000016001456af4433fda2cfc058e3b0d6f8094199c7cada7e861d0100000000001600142c4d1154deafd4b291838a6e0a3e7bb6908028eddf45010000000000160014e472e06817776da9c0bfa21fe943a4d1af55142eec15010000000000160014da8a70ea2acddd969b5ecaf123ee1cfeec92515825e401000000000017a9147236a47bca35cce334037c4fe73e1e0cb683fee087fbee020000000000160014ac63400a767632822ea045fef504dcf7440ac6f460e901000000000017a9148baf75a2019d970ece78c83babbccea75ddd894787743103000000000017a914f4c4dcd2c1df9831d24d489a705e1a1f8a8919af87312701000000000017a9142f59f6a544f5d742c2bd3d5f3d1770ab492be20187807b010000000000160014855f20eede048dd5623e04dcbc4bb4d81423cec077e110000000000016001450a019e898194115306fa470bf1ae756aac85d0972e10000000000001600147daab45106f05beb0f64660ffb7aa9db48c236c3a33c010000000000160014ab0952fa9c7f4afaa8ee576e9320d3d776c2c1aa041e01000000000017a914f83d66314bc435983b733ba8193dc0686e401d1c87f0e4060000000000160014d5ab6a142b32328bcfaa70ca3ef210660682853863e60000000000001600147c5b81b7bdd53d87106f2d1812f17de906f7de5226e514000000000017a9145b989f2f378659de64d3c43b6ce197097b86c0f187a9e3010000000000160014892a3f2788339923a11166ab9c6f867b97c41a6c6f0601000000000017a9141076bd4802347d296b12b19d05b3143d17b5c5c987210101000000000017a9144bcff10649bb6943774a3347109854dd394b783a87facd10000000000017a91432532608301b8832a7717537dce6b70dae314c968725e401000000000017a9144e25d6a808eaf9c0ea28ccdb10e0689dd328fabf87f9d1030000000000160014ed148831faabb7cd6f58bb23f339e08ac827d8f954ed00000000000017a91484cfcd4db8006c825011a4b75a066a2d18f4d4ad87c1c4010000000000160014e3d0ab5eecff5f4232da6c6bf0300be4dc08d245cbf10000000000001976a9141efbbed4d218b9d8b679201708e21439b2688e7f88ac8bde000000000000160014ea2274d6a17e126b41cd66edb354b6d017e9cb62b27e01000000000017a9144b117f5e443a8e3417684d92299e7242ed4a43628740e20a000000000017a914ade6a28bcf74a8d546fda3df2fb948e4fc0a2401870af500000000000017a914573d29c4035daa68c158beb9c9516722d8c3e33687ff48140000000000160014eb78daf00a708d394b7091678309d1247477c5f2185f070000000000160014f2c08bb331a10a4ac538e7219b04cf8157ea2a0f4fee010000000000160014113b5269d44b1f50250a4d994c58e29ca3dec67c25e401000000000017a9145960a87c9843e9b6e82b4eef90bf4883e48a7271876f37010000000000160014fa6f791cc49a2e0937ce1032bc2b932d13c4da038bde000000000000160014f7410bf47b5c5eb5e46f6576c8d30b76a003826525e401000000000017a9148312854e78b88e26b7d44d5c880486c54a85c43587ffd4010000000000160014c6d4960f25427cb935856e9af904c51d8e4821f63ed9030000000000160014858e155704971798ae93f6ffb88b75cd3990a73ed53c0300000000001600142fb06114be52da83a12c5ad1a84ac41d57467d6d43e100000000000017a9143e029801a803eabfd447759518c114cac9e24688875cd50300000000001600148ae58e30d9cc388794fd95169746a4229186050ca746030000000000160014c7607274e0a2efff79d12a51326dad53d42dcbdacd90020000000000160014b01b6d2d7a7311b8196830b46fcb275f25f138cf8bde00000000000016001410e02fd7afa8f603fb0859f5c80094e768c82c21d62002000000000017a914fe5580c031f89297809937ab06a66559b946161787bd9101000000000017a914332ceb63a262d636eb9e8d9b411e021dcd461add873c660100000000001600140745f55771891369f32e9bae2ca8ede2daeaf1accd2e010000000000160014a757a1fe3dcd3910404d18949050e5e42ade5e4f50fe01000000000017a914a205793936aeaa31c2b33f42f82da7bb35bc2ca98725e40100000000001600145aea1443f4b72d8dc34641fdd6fa94e5573ed931dc12010000000000160014d36c52f9ae83b92557719898888feff5054a16e2e8fc01000000000017a9140689d52e056fc0b21e3e17ab10325abb672c3aa587de1101000000000017a914818d3d6a00616ef90c10443db3b1ea10215dfff387d777010000000000160014712126bbd5ec823d6269c5f9f71e48a85fc22dc0bfd3160000000000160014b95ebab06be0dfe863870fb15d0a7e85afcf6e4e5780040000000000160014d193cf75756a75c27c39b750a080b3e8d8d14639e703000000000000160014b4c3fa8d89cfa2c2c40f0d2fcc773aa4107e4337ea5c9a000000000022512094b051fcb10b4fe6ee15a9fe6a94996f692281576569340f2946670b0d1be7f31b8f400000000000225120e805065e5c3a2d4323af4300670ea1bde22948c931522e35819da7fd500adae47dd6cd0000000000225120117b66a236c7a6f36aad42f61324bdd70d00cc7c1c505e672ff6671c735511e066e366000000000022512065e1faa4395a41aafb5fafe731bca629832b0958db7403e2d5e83851636c3e2f6dd6cd000000000022512079f3ab6642bfa650f6bef529397015048ab035432dec22c2f91cc8f22c064c60b012060000000000160014bfbe2519577edf8c056e0b1c697dc81af219fbabb0120600000000001600144f760137345b36674177794f44d8555165c6ec3db0120600000000001600142a6d234605e24457dab21236db0be45a9577ac31880103000000000016001406963cb167387f7424b48f6a87a52964483ecbaa8801030000000000160014a00e78303167784d11637b045c002806a30f870fecc32300000000001600143fd0dd24a595eb1c60815afc50bd2a6f3a35d63ee566300000000000225120c1a600ff7ffe619c912f8d0e23a23d2bc7bbcdc43bf7804ff902be30a3ba2128df7018000000000016001421b0caa3c71f1646667313b4aafac1b8f42a2f402b03ac0000000000225120d8145230061801d23e2349641997424927c98a7e8085c7cabd35b9a38807975328a08000000000001600141b9c186755da26bf7d50edfc19d2d7acc01f251f62eb8900000000002251203234fefe2e8f13fa578fec5916a75bde49a4a555888240390a46ab6592bf9d9ea987220000000000160014891354778f79a4f6e86445a6ac9523be4010db3246ad200000000000160014e7914025d712bf175675aa9e8c910e11e54fecf947090400000000001600149dd6706b6c2c592a935ae59b7ae0864ee0b81592b41216000000000016001405537517aee02812be1b08fd60f120b929c284717b7c03000000000017a91478c48d24c33cd40ea4aad9c60f67baa59dd3e3f587cd680700000000001600140eaf58bdd38331446eb14216a53151eea12578c591de00000000000017a91417a998607137530f4e647810f355998043a1174087de59020000000000160014a553e8cbeeb69f2b12faea784ded53100f2a7307b3120200000000001600148a8fd1315a361349c398eff4931b2172966d51b45f620800000000001600144d0c55e1f2a1c2b7a8614e18bf819b46210d55ead4af010000000000160014933884af32d951784d77f12ff5b9105ff30054132d9951000000000016001467f1168b7c689b69834d6fffffd511a1da9bb717aee100000000000017a9147601f415f2833ef0aa3ff9ee0e72cb08493b71e8871f28100000000000160014a333bdb2ba386a45c6e75dadc3292285a783d9ff72d4010000000000160014a1255ff1c799c053579058865e60e1fa1bc3a5b6b4ac02000000000017a914e451725b7f869ed4193a5a1d965c898bdf1aa3c0878d6c0300000000001600149a85d4576ddbf45c67ec0cc44f2ae711471683e20d40174f26ca56c3d9ea7fbbbd6ca489a752e82dd12bc304e194b662985e14f517f744bcaba85170424f47f3530c500d9adcee688097eec7665186efcb34b46de2674064aab51f8d286bcb854eab806925fbb56fac0c056fe0ae3df0051f7921f015cd00ee5bd88ab59081dfd94aef7f978e984f4c4642b91b0df90bd210353aaa9e61004001331633abc79a2d7b5ff964e044fc86f99567a9dac07a7750d2d6d986a4a9c997cc88d065f7aed520b86996d287d1c94bdc66895259d5cad15e3781c6ab462e004020ed66909c3d0775109952a7025bda6b2994a5228f4f99afa8b7ab2212971997d1abba74ca565144a7995a20f997f37a7c52d643ae8322c46a974bd691aad93b40991b5e734ecad2bac5af5f13cff51bdd773b11bd9b3d8e051744449b96ecf4f6c4bc37d85c3eb2d1223b1fa36cd682dce9f455ef7d01c6fdfaf4c8ff3e54405b405e23cea4c4fc098888bf0d4b80c6aa0961c3b858425894c2bc92fe4eb7bf8f664e72a5bb032dd257e3b2cc15b7b2a87deee4ef5a608ec97898b4c039dee0ef8940b972c585afdd253f44f527476aaa564f491aa5d48009a284ebf6c5108eedd652d6b4bfc5e4336388a116a877b8bd75c6cfa7ba7b86fdd1e7b25aa7695ad445bd404e655fa3099a306c22a536cd4e55a68bef726414b329f047fda12bc7389f5b7b76531c58dd6ab7fba9f136e6c174c1b28d27c197876872c392b0181e1e4a704d00fd780120045a602c7d83dfd1e7f576f611a26bbf7eae6d6b5f0a022b75684ffe4a8e5432ac201a39d16a6ffaa40fe404e64bc373c47bae126bd3d96dfcac5aa9c2137e089888ba201b6bf6534a8d3176db2e31063db3b1f35221c424306ee9a6b4ac50a46e7ee02eba202772abd64d7d82fa22700ebc9575d69548b699c04201f0d77e8e9602f58d8b64ba204505a302b1e030f1220b4e489c5ee28b855a4060e5a5e13fc739850b413a3121ba207a63f798bdcc5857c12c345f8373ba9167a93f431a3fe8be4fd74f9bbc0076fdba207b3e2369356df5edf768a5218f49c2a1ab871b46550d7ec8156bf2b378b38020ba20852d177ca592ee878b1272d6d166b694d5d419c07508246b07656c22f46b807bba20a3cc2583c4f46a92edace6621fa9dc592dd2fb674d7c5af6e59303f8648bd58eba20ac681c61c24074c42834d798b07d2ab5bdb6da7ea493f25cb3e691ceed663b33ba20ad20fef55bdcb8e14bf9c2de447b20ab36b3cd05261c7fc1e936f94d3514f7d2ba589c21c14a30b2e461b280c0b13a03799096ab1256589153fc4b9c8cead16dc0b64206970341a036a8c59eb337dd4315a160d45bdb86b68774f9a5d1edeca12c62f439c376369396af9caa2ab10633e36ef3230e0164283dbef096929f2c3f1f9a4d04df0e1f01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403411cda83eb114fac746d652e5474e4931d27db5e8c98c3111be533da0e46f6d1f8c3f7dc4e27b955a4fde0468e4d699b91dae186733278e04e1409c03820b81f0f01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341d69793c81d174d48b0408d1b721a65aa24d8e3222ca4ee2e9cc6113802e974947065875fa6bd10e6030352e15883945dde3597ab28264e92430b7cca0b8d7f0d01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341933a87d8a5be8cfee88c4bcbf8eeeaef1ffddfbdac7c5546278093d829337bfa0a6355bd0c6b6086cebb623251dfcf1fa957b90684ff0265265bb1f729e5231801482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb3953614034196e6a99e8eb1e09625e27b20d28995771ab7af173ab3b1a9d2503c8cb2c651c4e390add9c39b728259772ab137bb87b61435b2efd2097ffef65124fb89ef81b301482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341335eb166de8ab3f55976d80ebdfbb06cc2834f1ee5e31e2d003cc811ecc395820f7528a66da2c4e596649075ada02be901eada3eca12ac16fe1f796de1b40f8901482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341f4387fbbef49a7cc618656db2be04a5b5041091446f127cc050262709cf3c67b3f54719e93fae0451fde940c38ebb62ee446ea01d61bb249012e914f4d57edf201482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403415961912ec479b4f4a09a765b57d82f673e9f180e4ef6e3b4641fd1b15195350d4e4af4f30fa2e7cb50e9c86a8cf334049e10132c35bb3e04967a5ed879a5b02b01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb3953614034112501eb7425ea0e8243168e7456162e5fb65044307ccccc832330bb0fc203b6411bd85997d7fbb336418004623e6804c2a360d44f1e0479a5a53ecbe497c6c9801482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341e67b9afde8b2ce1af92c502f3d96dce85c3ac21778b65359d07f73042d52243dc8cdd836f1036fabc12523c2734555a0141af265eba3171f99503bf153fdbd1f01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361400000000',
  },
  {
    id: 5166,
    outcome: 'accepted',
    kind: 'p2wsh',
    direct: false,
    requestTxid: '475ea2ba833023a87167a1e487400059617b6ebd29bf961a93aa8b7f7c2474dc',
    sender: 'SP3RX8RME63CY63G5WZ8XQWZNTYNETYJESQKE071E.stacks-labs',
    amountSats: 2990000,
    maxFeeSats: 10000,
    burnHeight: 975801,
    version: '05',
    hashbytes: 'cea3b0ecaebbb9f7d0f610079795a35f6ea2001554979f34f07a8e1aa9ede05c',
    scriptPubKey: '0020cea3b0ecaebbb9f7d0f610079795a35f6ea2001554979f34f07a8e1aa9ede05c',
    address: 'bc1qe63mpm9whwul058kzqre09drtah2yqq42jte7d8s028p420dupwq2l2jew',
    payoutTxid: 'c9ed78674daa24885ad6dbc1d93f0359a6f5172f5e84e60d10dd5e2fad93e143',
    payoutVout: 15,
    feeSats: 95,
    acceptTxid: 'e58252d558ef41566648d89ca189d5882598358d29607fdce08adf1b8b595976',
    requestTx: {
      tx_id: '0x475ea2ba833023a87167a1e487400059617b6ebd29bf961a93aa8b7f7c2474dc',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SP2VMFSHP3EGCZNSQPAA31AJZKS7V70KXY0TT08RF',
      sponsored: false,
      nonce: 121,
      fee_rate: '39000',
      block_height: 9485579,
      burn_block_height: 975801,
      tx_result: {
        hex: '0x070100000000000000000000000000000012',
        repr: '(ok u18)',
      },
      contract_call: {
        contract_id: 'SP2VMFSHP3EGCZNSQPAA31AJZKS7V70KXY0TT08RF.reward-claim-registry-v1',
        function_name: 'process-reward-claims',
        function_signature:
          '(define-public (process-reward-claims (signer-manager trait_reference) (stakers (list 100 principal))))',
        function_args: [
          {
            hex: '0x0616f1d4628e30d9e30e05e7d1dbf3f5d7aaed7a4ecd0b737461636b732d6c616273',
            repr: "'SP3RX8RME63CY63G5WZ8XQWZNTYNETYJESQKE071E.stacks-labs",
            name: 'signer-manager',
            type: 'trait_reference',
          },
          {
            hex: '0x0b000000120514a48a1f1f78c877c04b1bd2ebd8eeca2450915e000514f8ac0155e923e912e86e73512f881c35b173ddf3051657179b2d3a01e0c8800ad05f5a11e82500c6f21105168b0c79d844d392158a63b3a55695839c7e8bb1a305160644dc6b82b16d0361d12291a2de4f26741ed1b60516d193cf75756a75c27c39b750a080b3e8d8d146390516f47e5012bb50dedd990c57cbc2cf9f02550dbac9051625eaacea1e61bfd3b38fad292769e72d54a0d5c30516b4c3fa8d89cfa2c2c40f0d2fcc773aa4107e4337051467a6492bc896d00316e41a7cf709b0a6308b1343051474d59c05fb451d5928fef1684e24c733f434186705147839e82c6a4c95c6d91b191fab54947d6d7fb2c20514a004c2308709cc8ad953b405d64e2529341c2dac0514a64476bf3ff38dce6ea6a9aefc1b5485c1f7f7790514cd53d5c5c13db3c036bbc70bdbeef94d400994dc0514e7d62f13ac0c2326dd63f7824b7513944cc990d4051423c79e53e69abd45842698ddee8357233b56df52051435c55a78cf2f7402e96d3f5989ea4f97d6acbdcb',
            repr: "(list 'SM2J8M7RZF347FG2B3F9EQP7ES8J514AY03EMGGSG 'SM3WAR0ANX4HYJ4Q8DSSN2BW83GTV2WYXYCX3YBP4 'SP1BHF6SD780Y1J401B85YPGHX0JG1HQJ24R9X7P4 'SP25GRYER8K9S45CACESTANMNGEE7X2XHMD49SADE 'SP349Q3BGARPT0V1T4H938PY9WK787PHPRFS3YAG 'SP38S7KVNENN7BGKW76VN1840PFMDHMA674C0FSZY 'SP3T7WM0JQD8DXQCS1HBWQGPFKW15A3DTS4JWNWVS 'SPJYNB7A3SGVZMXKHYPJJ9V9WWPN986NRESMN3P9 'SP2TC7YMDH77T5GP41W6JZK3Q7AJ10ZJ36ZQNGQ79 'SM1KTCJ9BS2BD00RPWGD7SXR9P2K312RK8FWNKT9M 'SM1TDB705ZD2HTP98ZVRPGKH4RWSZ8D0RCWM75J7Z 'SM1W3KT1CD969BHPS3CCHZATMJHYPTZXJRA76RATX 'SM2G09GHGGW4WS2PSAET0BNJE4MMK871DNKP37KXX 'SM2K48XNZ7ZSRVKKEMTMTXZ0VAJ2W3XZQF7Q9R6C1 'SM36N7NE5R4YV7G1PQF3GQPZEZ56M02CMVJJT7XRP 'SM3KXCBRKNG6269PXCFVR4JVN2EA4SJCGTHW7ZCWC 'SMHWF7JKWTDBTHC44TCDVVM3AWHKPNPZAANRQDWX 'SMTWAPKRSWQQ80Q9DMZNK2FA9YBXDB5XSF0BEWMY)",
            name: 'stakers',
            type: '(list 100 principal)',
          },
        ],
      },
      post_condition_mode: 'originator',
      post_conditions: [],
      events: [
        {
          event_index: 37,
          event_type: 'fungible_token_asset',
          tx_id: '0x475ea2ba833023a87167a1e487400059617b6ebd29bf961a93aa8b7f7c2474dc',
          asset: {
            asset_event_type: 'burn',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token',
            sender: 'SP3RX8RME63CY63G5WZ8XQWZNTYNETYJESQKE071E.stacks-labs',
            recipient: '',
            amount: '3000000',
          },
        },
        {
          event_index: 38,
          event_type: 'fungible_token_asset',
          tx_id: '0x475ea2ba833023a87167a1e487400059617b6ebd29bf961a93aa8b7f7c2474dc',
          asset: {
            asset_event_type: 'mint',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token-locked',
            sender: '',
            recipient: 'SP3RX8RME63CY63G5WZ8XQWZNTYNETYJESQKE071E.stacks-labs',
            amount: '3000000',
          },
        },
        {
          event_index: 39,
          event_type: 'smart_contract_log',
          tx_id: '0x475ea2ba833023a87167a1e487400059617b6ebd29bf961a93aa8b7f7c2474dc',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c0000000706616d6f756e7401000000000000000000000000002d9fb00c626c6f636b2d68656967687401000000000000000000000000000ee3b9076d61782d666565010000000000000000000000000000271009726563697069656e740c00000002096861736862797465730200000020cea3b0ecaebbb9f7d0f610079795a35f6ea2001554979f34f07a8e1aa9ede05c0776657273696f6e0200000001050a726571756573742d6964010000000000000000000000000000142e0673656e6465720616f1d4628e30d9e30e05e7d1dbf3f5d7aaed7a4ecd0b737461636b732d6c61627305746f7069630d000000117769746864726177616c2d637265617465',
              repr: '(tuple (amount u2990000) (block-height u975801) (max-fee u10000) (recipient (tuple (hashbytes 0xcea3b0ecaebbb9f7d0f610079795a35f6ea2001554979f34f07a8e1aa9ede05c) (version 0x05))) (request-id u5166) (sender \'SP3RX8RME63CY63G5WZ8XQWZNTYNETYJESQKE071E.stacks-labs) (topic "withdrawal-create"))',
            },
          },
        },
      ],
      event_count: 57,
      vm_error: null,
    },
    requestRawTx:
      '0x00000000010400b747e6361ba0cfd737b29430aa5f9e4fb3827df00000000000000079000000000000985800005c61c9c988a9e3e34854545dada87fcd914f6c42759614b10f17549b7c7cce906bfaaacf013241322348d36de798e9e9d2b7726735b082cd213b2200ddc41b210303000000000216b747e6361ba0cfd737b29430aa5f9e4fb3827df0187265776172642d636c61696d2d72656769737472792d76311570726f636573732d7265776172642d636c61696d73000000020616f1d4628e30d9e30e05e7d1dbf3f5d7aaed7a4ecd0b737461636b732d6c6162730b000000120514a48a1f1f78c877c04b1bd2ebd8eeca2450915e000514f8ac0155e923e912e86e73512f881c35b173ddf3051657179b2d3a01e0c8800ad05f5a11e82500c6f21105168b0c79d844d392158a63b3a55695839c7e8bb1a305160644dc6b82b16d0361d12291a2de4f26741ed1b60516d193cf75756a75c27c39b750a080b3e8d8d146390516f47e5012bb50dedd990c57cbc2cf9f02550dbac9051625eaacea1e61bfd3b38fad292769e72d54a0d5c30516b4c3fa8d89cfa2c2c40f0d2fcc773aa4107e4337051467a6492bc896d00316e41a7cf709b0a6308b1343051474d59c05fb451d5928fef1684e24c733f434186705147839e82c6a4c95c6d91b191fab54947d6d7fb2c20514a004c2308709cc8ad953b405d64e2529341c2dac0514a64476bf3ff38dce6ea6a9aefc1b5485c1f7f7790514cd53d5c5c13db3c036bbc70bdbeef94d400994dc0514e7d62f13ac0c2326dd63f7824b7513944cc990d4051423c79e53e69abd45842698ddee8357233b56df52051435c55a78cf2f7402e96d3f5989ea4f97d6acbdcb',
    getWithdrawalRequest:
      '0x0a0c0000000606616d6f756e7401000000000000000000000000002d9fb00c626c6f636b2d68656967687401000000000000000000000000000ee3b9076d61782d666565010000000000000000000000000000271009726563697069656e740c00000002096861736862797465730200000020cea3b0ecaebbb9f7d0f610079795a35f6ea2001554979f34f07a8e1aa9ede05c0776657273696f6e0200000001050673656e6465720616f1d4628e30d9e30e05e7d1dbf3f5d7aaed7a4ecd0b737461636b732d6c616273067374617475730a03',
    getSweepData:
      '0x0a0c000000030f73776565702d6275726e2d68617368020000002000000000000000000001c7ee2824dea49dcb4e3ac5fd25b0619725981c439ac71173776565702d6275726e2d68656967687401000000000000000000000000000ee3c20a73776565702d747869640200000020c9ed78674daa24885ad6dbc1d93f0359a6f5172f5e84e60d10dd5e2fad93e143',
    emily: {
      requestId: 5166,
      stacksBlockHash: 'cf25f7393ccc52009bd5b31a7bda5022fb2ab36e01b98e1fb8d62bd2dfd1737e',
      stacksBlockHeight: 9485579,
      recipient: '0020cea3b0ecaebbb9f7d0f610079795a35f6ea2001554979f34f07a8e1aa9ede05c',
      sender: 'SP3RX8RME63CY63G5WZ8XQWZNTYNETYJESQKE071E.stacks-labs',
      amount: 2990000,
      lastUpdateHeight: 9486044,
      lastUpdateBlockHash: 'ff896b435a0ce96ab2d159715f12eb3698efba57ae4a9d9916d8d27f8f5ee29a',
      status: 'confirmed',
      statusMessage:
        'Included in block ff896b435a0ce96ab2d159715f12eb3698efba57ae4a9d9916d8d27f8f5ee29a',
      parameters: {
        maxFee: 10000,
      },
      fulfillment: {
        BitcoinTxid: 'c9ed78674daa24885ad6dbc1d93f0359a6f5172f5e84e60d10dd5e2fad93e143',
        BitcoinTxIndex: 15,
        StacksTxid: 'e58252d558ef41566648d89ca189d5882598358d29607fdce08adf1b8b595976',
        BitcoinBlockHash: '00000000000000000001c7ee2824dea49dcb4e3ac5fd25b0619725981c439ac7',
        BitcoinBlockHeight: 975810,
        BtcFee: 95,
      },
      expectedFulfillmentInfo: {
        bitcoinBlockHeight: 975808,
        bitcoinTxid: '654bd44f702d217b1f36561ba0b992a6f88d99a15d248c93015fb423c8327461',
      },
      txid: '475ea2ba833023a87167a1e487400059617b6ebd29bf961a93aa8b7f7c2474dc',
    },
    acceptTx: {
      tx_id: '0xe58252d558ef41566648d89ca189d5882598358d29607fdce08adf1b8b595976',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SM37A2MMXMKEHTZ0N6N81TFF4XEA62J2ZR3NM7BW8',
      sponsored: false,
      nonce: 28019,
      fee_rate: '1421',
      block_height: 9486044,
      burn_block_height: 975809,
      tx_result: {
        hex: '0x0703',
        repr: '(ok true)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'accept-withdrawal-request',
        function_signature:
          '(define-public (accept-withdrawal-request (request-id uint) (bitcoin-txid (buff 32)) (signer-bitmap uint) (output-index uint) (fee uint) (burn-hash (buff 32)) (burn-height uint) (sweep-txid (buff 32))))',
        function_args: [
          {
            hex: '0x010000000000000000000000000000142e',
            repr: 'u5166',
            name: 'request-id',
            type: 'uint',
          },
          {
            hex: '0x0200000020c9ed78674daa24885ad6dbc1d93f0359a6f5172f5e84e60d10dd5e2fad93e143',
            repr: '0xc9ed78674daa24885ad6dbc1d93f0359a6f5172f5e84e60d10dd5e2fad93e143',
            name: 'bitcoin-txid',
            type: '(buff 32)',
          },
          {
            hex: '0x0100000000000000000000000000000000',
            repr: 'u0',
            name: 'signer-bitmap',
            type: 'uint',
          },
          {
            hex: '0x010000000000000000000000000000000f',
            repr: 'u15',
            name: 'output-index',
            type: 'uint',
          },
          {
            hex: '0x010000000000000000000000000000005f',
            repr: 'u95',
            name: 'fee',
            type: 'uint',
          },
          {
            hex: '0x020000002000000000000000000001c7ee2824dea49dcb4e3ac5fd25b0619725981c439ac7',
            repr: '0x00000000000000000001c7ee2824dea49dcb4e3ac5fd25b0619725981c439ac7',
            name: 'burn-hash',
            type: '(buff 32)',
          },
          {
            hex: '0x01000000000000000000000000000ee3c2',
            repr: 'u975810',
            name: 'burn-height',
            type: 'uint',
          },
          {
            hex: '0x0200000020c9ed78674daa24885ad6dbc1d93f0359a6f5172f5e84e60d10dd5e2fad93e143',
            repr: '0xc9ed78674daa24885ad6dbc1d93f0359a6f5172f5e84e60d10dd5e2fad93e143',
            name: 'sweep-txid',
            type: '(buff 32)',
          },
        ],
      },
      post_condition_mode: 'allow',
      post_conditions: [],
      events: [
        {
          event_index: 2,
          event_type: 'smart_contract_log',
          tx_id: '0xe58252d558ef41566648d89ca189d5882598358d29607fdce08adf1b8b595976',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c000000090c626974636f696e2d747869640200000020c9ed78674daa24885ad6dbc1d93f0359a6f5172f5e84e60d10dd5e2fad93e143096275726e2d68617368020000002000000000000000000001c7ee2824dea49dcb4e3ac5fd25b0619725981c439ac70b6275726e2d68656967687401000000000000000000000000000ee3c203666565010000000000000000000000000000005f0c6f75747075742d696e646578010000000000000000000000000000000f0a726571756573742d6964010000000000000000000000000000142e0d7369676e65722d6269746d617001000000000000000000000000000000000a73776565702d747869640200000020c9ed78674daa24885ad6dbc1d93f0359a6f5172f5e84e60d10dd5e2fad93e14305746f7069630d000000117769746864726177616c2d616363657074',
              repr: '(tuple (bitcoin-txid 0xc9ed78674daa24885ad6dbc1d93f0359a6f5172f5e84e60d10dd5e2fad93e143) (burn-hash 0x00000000000000000001c7ee2824dea49dcb4e3ac5fd25b0619725981c439ac7) (burn-height u975810) (fee u95) (output-index u15) (request-id u5166) (signer-bitmap u0) (sweep-txid 0xc9ed78674daa24885ad6dbc1d93f0359a6f5172f5e84e60d10dd5e2fad93e143) (topic "withdrawal-accept"))',
            },
          },
        },
      ],
      event_count: 3,
      vm_error: null,
    },
    btcTx: {
      txid: 'c9ed78674daa24885ad6dbc1d93f0359a6f5172f5e84e60d10dd5e2fad93e143',
      weight: 9221,
      fee: 4313,
      vin: [
        {
          txid: '6c9cf77980d6ecdae4ed7927031095eb6331e05cc03f3ba18cc16e42a8ddc4ea',
          vout: 0,
        },
        {
          txid: 'ad75c0de023ca8bbc2908078a4344134202dd964047a73761fe1b6178100d312',
          vout: 1,
        },
        {
          txid: '06b77adcd1c68bc8638d4737b28227ae0ad670453eeb290f3d69abd08e6adb5e',
          vout: 1,
        },
        {
          txid: '89ad0742cbd2177b6fce693a7942ef02bae59e98b9a1f9a89009b5da639bf26c',
          vout: 1,
        },
        {
          txid: '4faae412a3c8551322fd980c3d748224f8ad14265055ee9bdd193302e17acc78',
          vout: 1,
        },
        {
          txid: '94096f8b8fcaf0e11dc2ce879cf9949cb2a0e1d0fb8acd8aab59d9f0ee9c609c',
          vout: 1,
        },
        {
          txid: '32a08701a31a1c9322d5864706ddeea9ce4912824d3ec846eedb5fe16e7a39a1',
          vout: 1,
        },
        {
          txid: 'ad29dafb13fa1f0f6e0992fad13253f5dce2e4c4d5b042ad776b1760acd6aeca',
          vout: 1,
        },
        {
          txid: '1d831b582cf34e1e94d60e6d781bbe15acb2aac3699318c132c19f02327014d1',
          vout: 1,
        },
        {
          txid: 'ee96f70b38d569c6ec989e9059eb8482ead701bbe7549e085609e25ec1ae1dd4',
          vout: 1,
        },
        {
          txid: 'e37c4cbaf34f885f548b8b8dd0d59320c76baa8be3479549e34184b49732e3d6',
          vout: 1,
        },
        {
          txid: '9f857fab577ae3df8679d773a90da4751f311a64656699bc0e6b188b34c211fe',
          vout: 1,
        },
      ],
      vout: [
        {
          scriptpubkey: '51208056b53d7e41f8f80b4a2daa457b07f81b1b5f42036152c7d055cd9c7fcdf753',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1psptt20t7g8u0sz629k4y27c8lqd3kh6zqds4937s2hxecl7d7afsrhteyx',
          value: 248278976095,
        },
        {
          scriptpubkey: '6a0a543301a12804ffffff01',
          scriptpubkey_type: 'op_return',
          value: 0,
        },
        {
          scriptpubkey: '512094b051fcb10b4fe6ee15a9fe6a94996f692281576569340f2946670b0d1be7f3',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1pjjc9rl93pd87dms448lx49yeda5j9q2hv45ngrefgenskrgmulesl054mz',
          value: 8491449,
        },
        {
          scriptpubkey: '5120e805065e5c3a2d4323af4300670ea1bde22948c931522e35819da7fd500adae4',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1paqzsvhju8gk5xga0gvqxwr4phh3zjjxfx9fzudvpnknl65q2mtjqa49lkt',
          value: 3550994,
        },
        {
          scriptpubkey: '5120117b66a236c7a6f36aad42f61324bdd70d00cc7c1c505e672ff6671c735511e0',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1pz9akdg3kc7n0x64dgtmpxf9a6uxspnrur3g9uee07en3cu64z8sqhmmxqz',
          value: 11323278,
        },
        {
          scriptpubkey: '512065e1faa4395a41aafb5fafe731bca629832b0958db7403e2d5e83851636c3e2f',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1pvhsl4fpetfq6476l4lnnr09x9xpjkz2cmd6q8ck4aqu9zcmv8chszx9y3a',
          value: 5659632,
        },
        {
          scriptpubkey: '512079f3ab6642bfa650f6bef529397015048ab035432dec22c2f91cc8f22c064c60',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1p08e6kejzh7n9pa47755njuq4qj9tqd2r9hkz9sherny0ytqxf3sqwrd7ch',
          value: 11323265,
        },
        {
          scriptpubkey: '0014bfbe2519577edf8c056e0b1c697dc81af219fbab',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qh7lz2x2h0m0ccptwpvwxjlwgrtepn7atnswup6',
          value: 398000,
        },
        {
          scriptpubkey: '00144f760137345b36674177794f44d8555165c6ec3d',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qfamqzde5tvmxwsth0985fkz429judmpawxjlp0',
          value: 398000,
        },
        {
          scriptpubkey: '00142a6d234605e24457dab21236db0be45a9577ac31',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q9fkjx3s9ufz90k4jzgmdkzlyt22h0tp3x92ua9',
          value: 398000,
        },
        {
          scriptpubkey: '001406963cb167387f7424b48f6a87a52964483ecbaa',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qq6trevt88plhgf953a4g0fffv3yraja2a50h5k',
          value: 197000,
        },
        {
          scriptpubkey: '0014a00e78303167784d11637b045c002806a30f870f',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q5q88svp3vauy6ytr0vz9cqpgq63slpc0v3t955',
          value: 197000,
        },
        {
          scriptpubkey: '0014b95ebab06be0dfe863870fb15d0a7e85afcf6e4e',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qh90t4vrtur07scu8p7c46zn7skhu7mjw5aqrjh',
          value: 1495999,
        },
        {
          scriptpubkey: '0014d193cf75756a75c27c39b750a080b3e8d8d14639',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q6xfu7at4df6uylpekag2pq9narvdz33etsztut',
          value: 294999,
        },
        {
          scriptpubkey: '0014b4c3fa8d89cfa2c2c40f0d2fcc773aa4107e4337',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qknpl4rvfe73v93q0p5hucae65sg8usehfyudhs',
          value: 999,
        },
        {
          scriptpubkey: '0020cea3b0ecaebbb9f7d0f610079795a35f6ea2001554979f34f07a8e1aa9ede05c',
          scriptpubkey_type: 'v0_p2wsh',
          scriptpubkey_address: 'bc1qe63mpm9whwul058kzqre09drtah2yqq42jte7d8s028p420dupwq2l2jew',
          value: 2990000,
        },
        {
          scriptpubkey: '00200402dfa6d02a57d2b580aab9511bc09e87b353407357b1bb2708ba8a58270f25',
          scriptpubkey_type: 'v0_p2wsh',
          scriptpubkey_address: 'bc1qqspdlfks9fta9dvq42u4zx7qn6rmx56qwdtmrwe8pzag5kp8pujs5ts3u8',
          value: 41959970,
        },
        {
          scriptpubkey: '0020cf03ad850f3b9064fd9a6c8ec41f3f72cd11a27fb791dcb482ca02eb74afaa27',
          scriptpubkey_type: 'v0_p2wsh',
          scriptpubkey_address: 'bc1qeup6mpg08wgxflv6dj8vg8elwtx3rgnlk7gaedyzegpwka904gns4aa772',
          value: 14990000,
        },
        {
          scriptpubkey: '00143fd0dd24a595eb1c60815afc50bd2a6f3a35d63e',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q8lgd6f99jh43ccyptt79p0f2duart437zu7scn',
          value: 1966944,
        },
        {
          scriptpubkey: '5120c1a600ff7ffe619c912f8d0e23a23d2bc7bbcdc43bf7804ff902be30a3ba2128',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1pcxnqplmlleseeyf0358z8g3a90rmhnwy80mcqnleq2lrpga6yy5q643yy4',
          value: 2662132,
        },
        {
          scriptpubkey: '001421b0caa3c71f1646667313b4aafac1b8f42a2f40',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qyxcv4g78rutyvennzw6247kphr6z5t6qc08yju',
          value: 1343944,
        },
        {
          scriptpubkey: '5120d8145230061801d23e2349641997424927c98a7e8085c7cabd35b9a388079753',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1pmq29yvqxrqqay03rf9jpn96zfynunzn7szzu0j4axku68zq8jafsk6m6n7',
          value: 9462411,
        },
        {
          scriptpubkey: '00141b9c186755da26bf7d50edfc19d2d7acc01f251f',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qrwwpse64mgnt7l2sah7pn5kh4nqp7fglya3c3j',
          value: 7075540,
        },
        {
          scriptpubkey: '51203234fefe2e8f13fa578fec5916a75bde49a4a555888240390a46ab6592bf9d9e',
          scriptpubkey_type: 'v1_p2tr',
          scriptpubkey_address: 'bc1pxg60al3w3ufl54u0a3v3df6mmey6ff243zpyqwg2g64kty4lnk0quxrhcu',
          value: 7586831,
        },
        {
          scriptpubkey: '0014891354778f79a4f6e86445a6ac9523be4010db32',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1q3yf4gau00xj0d6rygkn2e9frheqppkejqdu7yf',
          value: 1898980,
        },
        {
          scriptpubkey: '0014e7914025d712bf175675aa9e8c910e11e54fecf9',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qu7g5qfwhz2l3w4n4420geygwz8j5lm8e7r9s3w',
          value: 1797035,
        },
        {
          scriptpubkey: '00149dd6706b6c2c592a935ae59b7ae0864ee0b81592',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qnht8q6mv93vj4y66ukdh4cyxfmsts9vjk20q88',
          value: 221406,
        },
        {
          scriptpubkey: '001405537517aee02812be1b08fd60f120b929c28471',
          scriptpubkey_type: 'v0_p2wpkh',
          scriptpubkey_address: 'bc1qq4fh29awuq5p90smpr7kpufqhy5u9pr3tn9jth',
          value: 1213681,
        },
      ],
      status: {
        confirmed: true,
        block_height: 975810,
        block_hash: '00000000000000000001c7ee2824dea49dcb4e3ac5fd25b0619725981c439ac7',
        block_time: 1794668141,
      },
    },
    btcTxHex:
      '0200000000010ceac4dda8426ec18ca13b3fc05ce03163eb9510032779ede4daecd68079f79c6c00000000000000000012d3008117b6e11f76737a0464d92d20344134a4788090c2bba83c02dec075ad0100000000000000005edb6a8ed0ab693d0f29eb3e4570d60aae2782b237478d63c88bc6d1dc7ab7060100000000000000006cf29b63dab50990a8f9a1b9989ee5ba02ef42793a69ce6f7b17d2cb4207ad8901000000000000000078cc7ae1023319dd9bee55502614adf82482743d0c98fd221355c8a312e4aa4f0100000000000000009c609ceef0d959ab8acd8afbd0e1a0b29c94f99c87cec21de1f0ca8f8b6f0994010000000000000000a1397a6ee15fdbee46c83e4d821249cea9eedd064786d522931c1aa30187a032010000000000000000caaed6ac60176b77ad42b0d5c4e4e2dcf55332d1fa92096e0f1ffa13fbda29ad010000000000000000d1147032029fc132c1189369c3aab2ac15be1b786d0ed6941e4ef32c581b831d010000000000000000d41daec15ee20956089e54e7bb01d7ea8284eb59909e98ecc669d5380bf796ee010000000000000000d6e33297b48441e3499547e38baa6bc72093d5d08d8b8b545f884ff3ba4c7ce3010000000000000000fe11c2348b186b0ebc996665641a311f75a40da973d77986dfe37a57ab7f859f0100000000000000001c5f8694ce390000002251208056b53d7e41f8f80b4a2daa457b07f81b1b5f42036152c7d055cd9c7fcdf75300000000000000000c6a0a543301a12804ffffff01b99181000000000022512094b051fcb10b4fe6ee15a9fe6a94996f692281576569340f2946670b0d1be7f3122f360000000000225120e805065e5c3a2d4323af4300670ea1bde22948c931522e35819da7fd500adae48ec7ac0000000000225120117b66a236c7a6f36aad42f61324bdd70d00cc7c1c505e672ff6671c735511e0f05b56000000000022512065e1faa4395a41aafb5fafe731bca629832b0958db7403e2d5e83851636c3e2f81c7ac000000000022512079f3ab6642bfa650f6bef529397015048ab035432dec22c2f91cc8f22c064c60b012060000000000160014bfbe2519577edf8c056e0b1c697dc81af219fbabb0120600000000001600144f760137345b36674177794f44d8555165c6ec3db0120600000000001600142a6d234605e24457dab21236db0be45a9577ac31880103000000000016001406963cb167387f7424b48f6a87a52964483ecbaa8801030000000000160014a00e78303167784d11637b045c002806a30f870fbfd3160000000000160014b95ebab06be0dfe863870fb15d0a7e85afcf6e4e5780040000000000160014d193cf75756a75c27c39b750a080b3e8d8d14639e703000000000000160014b4c3fa8d89cfa2c2c40f0d2fcc773aa4107e4337b09f2d0000000000220020cea3b0ecaebbb9f7d0f610079795a35f6ea2001554979f34f07a8e1aa9ede05c22428002000000002200200402dfa6d02a57d2b580aab9511bc09e87b353407357b1bb2708ba8a58270f25b0bae40000000000220020cf03ad850f3b9064fd9a6c8ec41f3f72cd11a27fb791dcb482ca02eb74afaa2760031e00000000001600143fd0dd24a595eb1c60815afc50bd2a6f3a35d63ef49e280000000000225120c1a600ff7ffe619c912f8d0e23a23d2bc7bbcdc43bf7804ff902be30a3ba2128c88114000000000016001421b0caa3c71f1646667313b4aafac1b8f42a2f408b62900000000000225120d8145230061801d23e2349641997424927c98a7e8085c7cabd35b9a388079753d4f66b00000000001600141b9c186755da26bf7d50edfc19d2d7acc01f251f0fc47300000000002251203234fefe2e8f13fa578fec5916a75bde49a4a555888240390a46ab6592bf9d9ee4f91c0000000000160014891354778f79a4f6e86445a6ac9523be4010db32ab6b1b0000000000160014e7914025d712bf175675aa9e8c910e11e54fecf9de600300000000001600149dd6706b6c2c592a935ae59b7ae0864ee0b81592f18412000000000016001405537517aee02812be1b08fd60f120b929c284710d407db946f8afb8451d71d3044da8ce48dc034594fcc5ce64a390dc9abe8adde86c8cf2f0101e6326d6dfce638f14ad7da9df537fa9ea4e5f2a29532818639c2c7a404730fed18d753efa0f659c55d66b577f6510288df40e0177a9110d196fe99b6d49baddfa3706269a91b29a694daeb6f8d273f30f4b99c2037f8460e7b38698500040eef4734b57ff27bd4c5e560c46a372bcafeeea20aaf4aca74edc118cff94ba11008d35b71cc2725608fa06f1a63a9d833fdcbc0be9c70b2c56632999d1fbd52e00405156b7ad5e0705cb84778e75171c4b9636ccdbf4fef11734f2e083fdecc8b682162677bc39928ade2451f25b8bc182b0d05b111d2af6d223eb26c7429d677fde40db6008f08ece484aba121b7528f00c85bf46f23000e09df32375b7c8166c19ba3cfa4579502be56a3ae816b68c73b72dfd5bec120141198dafb29b62a04d6f5640e39915fb08e098dc1410912badde96ff2c16e1e15c4ceca07a5ea93956c71e777dc5f907cf15085a9ac791389151d121b56a5ab6c968be1730782f2306bbf8ac4030857d57f4fd9b0b055c16a4d36c656b032577d4f03c5a4d3f05961024cd7f4dce64de370458d1e04c4513a7c74897c3762ab948f297397caf594a99c774892740e2aacc52cb00ab06c6f4b708b6a4185c6cd7f2387ff5b8a72a0fbc6fbd115a2f8ba7e99610670b1a8b2f511f2b2766f0aa0db1a608b1e7c723923d7b936f5e6000fd780120045a602c7d83dfd1e7f576f611a26bbf7eae6d6b5f0a022b75684ffe4a8e5432ac201a39d16a6ffaa40fe404e64bc373c47bae126bd3d96dfcac5aa9c2137e089888ba201b6bf6534a8d3176db2e31063db3b1f35221c424306ee9a6b4ac50a46e7ee02eba202772abd64d7d82fa22700ebc9575d69548b699c04201f0d77e8e9602f58d8b64ba204505a302b1e030f1220b4e489c5ee28b855a4060e5a5e13fc739850b413a3121ba207a63f798bdcc5857c12c345f8373ba9167a93f431a3fe8be4fd74f9bbc0076fdba207b3e2369356df5edf768a5218f49c2a1ab871b46550d7ec8156bf2b378b38020ba20852d177ca592ee878b1272d6d166b694d5d419c07508246b07656c22f46b807bba20a3cc2583c4f46a92edace6621fa9dc592dd2fb674d7c5af6e59303f8648bd58eba20ac681c61c24074c42834d798b07d2ab5bdb6da7ea493f25cb3e691ceed663b33ba20ad20fef55bdcb8e14bf9c2de447b20ab36b3cd05261c7fc1e936f94d3514f7d2ba589c21c14a30b2e461b280c0b13a03799096ab1256589153fc4b9c8cead16dc0b64206970341de0f1b244210f5f692cd743f2d37b4c9b9efa8d5597784a5037e57ea0459c5ee88eecbb6e610a61654194c4f34cae245ff70a615ec6c3c2980cc818413e052c501482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341e6334631448ab6080bf4ada1d54733f28aca79799dcf11ec29d5273d7fc33c465825cda070a409e817005ee5f137d32e4e4531da38d4d26b78db31e58d8028af01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb3953614034161e4a5aa219ed496119878ca151c77e9c229c1910d25ad204cf9243cf6c9fd3baea642fb0e4491c7c23be5168845ea3ee853f0a299364763560133880d19aa1301482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403418e55802e68375d7acceaa2cfe533c2239b404949bed2d36ea6d97cb7815867763cc42e54e110e2ccf37ae72f109d8ecf58ed90c637f45a073606c8acaae4ca8101482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341216579fe71e0bc074cf0085f0b175f9464d0a0161d096e888bf6597020eeaa31f0727cb4031f684da80d6c7f506ae7e2d92f5587948f5e9e33ba61e42fed402e01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403412f52c9784a76c4224bca42ad3f0c32008db54883c338aabb35cf97780cee4e431ab9d09df225e9899540d769591796a5c00b28944661f286d3f69a2dddb7aa7f01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403414198451aa5c26f9dccbac8a92ce409b0cbe4496254b99bb206e96abe2be4829e686923deda16ca353925ff7d6288c3ff274b26fa7f689e4860d33f3985554f8501482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403414f71d203e38fe95b1f64a975c13e527bd3a822fbe17a2fd7c2d193f85d01a9bd5023dfd51364b88fef7d6b10b0c18f127732a9c196fd8677d7196f0e7019a70a01482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341276d2a61d1a0f185f22ea857c48f67d93faf6df576adf1b2774231d63bdd23d3d6bc42a51686c4da8c8bbee890f715c34bd6037b348936e87f54774c381ae59701482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb39536140341fc940e9a8743c8edf1fa251a61fa0b7f5101d6d2ec9f32341c0b2a8adcc064cdbbe15b02acdc75b23efd42996d3e4d9a409c017c0889addf49c3b6210a838ab401482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361403415af41f2caaa01d08c7430dbeec55a2575861f54c9937f184784bc855aec935e0f8fdf8c80569e76fd54a2986c74c438f40472b0c459f7c1946026e9f17127e1201482400000000000138800616000000000000000000000000000000000000000005706f782d357520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac41c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0a43373806cf7c76f82968115a55c47f37665808522e789db8d80f07eb395361400000000',
  },
  {
    id: 5102,
    outcome: 'rejected',
    kind: 'p2wpkh',
    direct: true,
    requestTxid: 'd722b6c4f07361a37b5860110e6416f6ba625e8176a64bcc55ea027408e0dd4f',
    sender: 'SP1GCTT4KG0E5BJTPJXQHSH482MCVA2XYXQKV0HQW',
    amountSats: 18625,
    maxFeeSats: 340,
    burnHeight: 975084,
    version: '04',
    hashbytes: '5588dc1238051fbebb415a7ba43bd461a5e96714',
    scriptPubKey: '00145588dc1238051fbebb415a7ba43bd461a5e96714',
    address: null,
    payoutTxid: null,
    payoutVout: null,
    feeSats: null,
    acceptTxid: null,
    requestTx: {
      tx_id: '0xd722b6c4f07361a37b5860110e6416f6ba625e8176a64bcc55ea027408e0dd4f',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SP1GCTT4KG0E5BJTPJXQHSH482MCVA2XYXQKV0HQW',
      sponsored: false,
      nonce: 165,
      fee_rate: '3000',
      block_height: 9442999,
      burn_block_height: 975083,
      tx_result: {
        hex: '0x0701000000000000000000000000000013ee',
        repr: '(ok u5102)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'initiate-withdrawal-request',
        function_signature:
          '(define-public (initiate-withdrawal-request (amount uint) (recipient (tuple (hashbytes (buff 32)) (version (buff 1)))) (max-fee uint)))',
        function_args: [
          {
            hex: '0x01000000000000000000000000000048c1',
            repr: 'u18625',
            name: 'amount',
            type: 'uint',
          },
          {
            hex: '0x0c000000020968617368627974657302000000145588dc1238051fbebb415a7ba43bd461a5e967140776657273696f6e020000000104',
            repr: '(tuple (hashbytes 0x5588dc1238051fbebb415a7ba43bd461a5e96714) (version 0x04))',
            name: 'recipient',
            type: '(tuple (hashbytes (buff 32)) (version (buff 1)))',
          },
          {
            hex: '0x0100000000000000000000000000000154',
            repr: 'u340',
            name: 'max-fee',
            type: 'uint',
          },
        ],
      },
      post_condition_mode: 'deny',
      post_conditions: [
        {
          principal: {
            type_id: 'principal_standard',
            address: 'SP1GCTT4KG0E5BJTPJXQHSH482MCVA2XYXQKV0HQW',
          },
          condition_code: 'sent_equal_to',
          amount: '18965',
          type: 'fungible',
          asset: {
            asset_name: 'sbtc-token',
            contract_address: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4',
            contract_name: 'sbtc-token',
          },
        },
      ],
      events: [
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          tx_id: '0xd722b6c4f07361a37b5860110e6416f6ba625e8176a64bcc55ea027408e0dd4f',
          asset: {
            asset_event_type: 'burn',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token',
            sender: 'SP1GCTT4KG0E5BJTPJXQHSH482MCVA2XYXQKV0HQW',
            recipient: '',
            amount: '18965',
          },
        },
        {
          event_index: 1,
          event_type: 'fungible_token_asset',
          tx_id: '0xd722b6c4f07361a37b5860110e6416f6ba625e8176a64bcc55ea027408e0dd4f',
          asset: {
            asset_event_type: 'mint',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token-locked',
            sender: '',
            recipient: 'SP1GCTT4KG0E5BJTPJXQHSH482MCVA2XYXQKV0HQW',
            amount: '18965',
          },
        },
        {
          event_index: 2,
          event_type: 'smart_contract_log',
          tx_id: '0xd722b6c4f07361a37b5860110e6416f6ba625e8176a64bcc55ea027408e0dd4f',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c0000000706616d6f756e7401000000000000000000000000000048c10c626c6f636b2d68656967687401000000000000000000000000000ee0ec076d61782d666565010000000000000000000000000000015409726563697069656e740c000000020968617368627974657302000000145588dc1238051fbebb415a7ba43bd461a5e967140776657273696f6e0200000001040a726571756573742d696401000000000000000000000000000013ee0673656e646572051660cd6893801c55cb56976f1cc4881519b50bbeed05746f7069630d000000117769746864726177616c2d637265617465',
              repr: '(tuple (amount u18625) (block-height u975084) (max-fee u340) (recipient (tuple (hashbytes 0x5588dc1238051fbebb415a7ba43bd461a5e96714) (version 0x04))) (request-id u5102) (sender \'SP1GCTT4KG0E5BJTPJXQHSH482MCVA2XYXQKV0HQW) (topic "withdrawal-create"))',
            },
          },
        },
      ],
      event_count: 3,
      vm_error: null,
    },
    requestRawTx:
      '0x0000000001040060cd6893801c55cb56976f1cc4881519b50bbeed00000000000000a50000000000000bb800015d837e8ebb4f6637cb185f650c917ecd3cc8d4401311816f9aff3c9d5e521036199729c5f21225dc2947b39f78928935ba19e0dc1c2d0219b3f010342d01da7d03020000000101021660cd6893801c55cb56976f1cc4881519b50bbeed14f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0a736274632d746f6b656e0a736274632d746f6b656e010000000000004a150214f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0f736274632d7769746864726177616c1b696e6974696174652d7769746864726177616c2d726571756573740000000301000000000000000000000000000048c10c000000020968617368627974657302000000145588dc1238051fbebb415a7ba43bd461a5e967140776657273696f6e0200000001040100000000000000000000000000000154',
    getWithdrawalRequest:
      '0x0a0c0000000606616d6f756e7401000000000000000000000000000048c10c626c6f636b2d68656967687401000000000000000000000000000ee0ec076d61782d666565010000000000000000000000000000015409726563697069656e740c000000020968617368627974657302000000145588dc1238051fbebb415a7ba43bd461a5e967140776657273696f6e0200000001040673656e646572051660cd6893801c55cb56976f1cc4881519b50bbeed067374617475730a04',
    getSweepData: '0x09',
    emily: {
      requestId: 5102,
      stacksBlockHash: '706db0feaa8e5ae2bfe306847a5d9346c9749e3727dca8d4e985fc4deb10195a',
      stacksBlockHeight: 9442999,
      recipient: '00145588dc1238051fbebb415a7ba43bd461a5e96714',
      sender: 'SP1GCTT4KG0E5BJTPJXQHSH482MCVA2XYXQKV0HQW',
      amount: 18625,
      lastUpdateHeight: 9444400,
      lastUpdateBlockHash: 'e5da50e27a2cc1044334171fb5f7cbd49dd3ef9c95e9d8c3c86117990cb747b1',
      status: 'failed',
      statusMessage: 'Rejected',
      parameters: {
        maxFee: 340,
      },
      expectedFulfillmentInfo: {
        bitcoinBlockHeight: 975090,
      },
      txid: 'd722b6c4f07361a37b5860110e6416f6ba625e8176a64bcc55ea027408e0dd4f',
    },
    acceptTx: null,
    btcTx: null,
    btcTxHex: null,
  },
  {
    id: 5092,
    outcome: 'rejected',
    kind: 'p2sh',
    direct: true,
    requestTxid: '5a656f99c5bfb112e0953632d3d2c5ef7b9f80db9ed384068102e114a154dafa',
    sender: 'SP367FZQBQTAQH7CJWGY1EGX5QCDW4GMEW8S1P3MC',
    amountSats: 66676,
    maxFeeSats: 680,
    burnHeight: 975046,
    version: '01',
    hashbytes: '8b247c6044fcbd79e36dc14c2020abc618a6c3c6',
    scriptPubKey: 'a9148b247c6044fcbd79e36dc14c2020abc618a6c3c687',
    address: null,
    payoutTxid: null,
    payoutVout: null,
    feeSats: null,
    acceptTxid: null,
    requestTx: {
      tx_id: '0x5a656f99c5bfb112e0953632d3d2c5ef7b9f80db9ed384068102e114a154dafa',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SP367FZQBQTAQH7CJWGY1EGX5QCDW4GMEW8S1P3MC',
      sponsored: false,
      nonce: 158,
      fee_rate: '3000',
      block_height: 9441044,
      burn_block_height: 975046,
      tx_result: {
        hex: '0x0701000000000000000000000000000013e4',
        repr: '(ok u5092)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'initiate-withdrawal-request',
        function_signature:
          '(define-public (initiate-withdrawal-request (amount uint) (recipient (tuple (hashbytes (buff 32)) (version (buff 1)))) (max-fee uint)))',
        function_args: [
          {
            hex: '0x0100000000000000000000000000010474',
            repr: 'u66676',
            name: 'amount',
            type: 'uint',
          },
          {
            hex: '0x0c000000020968617368627974657302000000148b247c6044fcbd79e36dc14c2020abc618a6c3c60776657273696f6e020000000101',
            repr: '(tuple (hashbytes 0x8b247c6044fcbd79e36dc14c2020abc618a6c3c6) (version 0x01))',
            name: 'recipient',
            type: '(tuple (hashbytes (buff 32)) (version (buff 1)))',
          },
          {
            hex: '0x01000000000000000000000000000002a8',
            repr: 'u680',
            name: 'max-fee',
            type: 'uint',
          },
        ],
      },
      post_condition_mode: 'deny',
      post_conditions: [
        {
          principal: {
            type_id: 'principal_standard',
            address: 'SP367FZQBQTAQH7CJWGY1EGX5QCDW4GMEW8S1P3MC',
          },
          condition_code: 'sent_equal_to',
          amount: '67356',
          type: 'fungible',
          asset: {
            asset_name: 'sbtc-token',
            contract_address: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4',
            contract_name: 'sbtc-token',
          },
        },
      ],
      events: [
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          tx_id: '0x5a656f99c5bfb112e0953632d3d2c5ef7b9f80db9ed384068102e114a154dafa',
          asset: {
            asset_event_type: 'burn',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token',
            sender: 'SP367FZQBQTAQH7CJWGY1EGX5QCDW4GMEW8S1P3MC',
            recipient: '',
            amount: '67356',
          },
        },
        {
          event_index: 1,
          event_type: 'fungible_token_asset',
          tx_id: '0x5a656f99c5bfb112e0953632d3d2c5ef7b9f80db9ed384068102e114a154dafa',
          asset: {
            asset_event_type: 'mint',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token-locked',
            sender: '',
            recipient: 'SP367FZQBQTAQH7CJWGY1EGX5QCDW4GMEW8S1P3MC',
            amount: '67356',
          },
        },
        {
          event_index: 2,
          event_type: 'smart_contract_log',
          tx_id: '0x5a656f99c5bfb112e0953632d3d2c5ef7b9f80db9ed384068102e114a154dafa',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c0000000706616d6f756e7401000000000000000000000000000104740c626c6f636b2d68656967687401000000000000000000000000000ee0c6076d61782d66656501000000000000000000000000000002a809726563697069656e740c000000020968617368627974657302000000148b247c6044fcbd79e36dc14c2020abc618a6c3c60776657273696f6e0200000001010a726571756573742d696401000000000000000000000000000013e40673656e6465720516cc77feebbe95789d92e43c1743a5bb1bc2428ee205746f7069630d000000117769746864726177616c2d637265617465',
              repr: '(tuple (amount u66676) (block-height u975046) (max-fee u680) (recipient (tuple (hashbytes 0x8b247c6044fcbd79e36dc14c2020abc618a6c3c6) (version 0x01))) (request-id u5092) (sender \'SP367FZQBQTAQH7CJWGY1EGX5QCDW4GMEW8S1P3MC) (topic "withdrawal-create"))',
            },
          },
        },
      ],
      event_count: 3,
      vm_error: null,
    },
    requestRawTx:
      '0x00000000010400cc77feebbe95789d92e43c1743a5bb1bc2428ee2000000000000009e0000000000000bb800002aa806928453f7d6404fcece7009af255c29490b8625881843a0e5954b9134a85d57f1c152ed04e4c297439b0cd009db1e19f4018b7e57e31e5e597336ca9076030200000001010216cc77feebbe95789d92e43c1743a5bb1bc2428ee214f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0a736274632d746f6b656e0a736274632d746f6b656e01000000000001071c0214f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0f736274632d7769746864726177616c1b696e6974696174652d7769746864726177616c2d726571756573740000000301000000000000000000000000000104740c000000020968617368627974657302000000148b247c6044fcbd79e36dc14c2020abc618a6c3c60776657273696f6e02000000010101000000000000000000000000000002a8',
    getWithdrawalRequest:
      '0x0a0c0000000606616d6f756e7401000000000000000000000000000104740c626c6f636b2d68656967687401000000000000000000000000000ee0c6076d61782d66656501000000000000000000000000000002a809726563697069656e740c000000020968617368627974657302000000148b247c6044fcbd79e36dc14c2020abc618a6c3c60776657273696f6e0200000001010673656e6465720516cc77feebbe95789d92e43c1743a5bb1bc2428ee2067374617475730a04',
    getSweepData: '0x09',
    emily: {
      requestId: 5092,
      stacksBlockHash: '69bcbbb2fd878dc7b7d4361376bda71b167486e371ba8df86a4d228297158b78',
      stacksBlockHeight: 9441044,
      recipient: 'a9148b247c6044fcbd79e36dc14c2020abc618a6c3c687',
      sender: 'SP367FZQBQTAQH7CJWGY1EGX5QCDW4GMEW8S1P3MC',
      amount: 66676,
      lastUpdateHeight: 9442106,
      lastUpdateBlockHash: 'c362fe65429b3096ec96f2cb01f155985af189f1e2a2d9f1f56e8ec045de205f',
      status: 'failed',
      statusMessage: 'Rejected',
      parameters: {
        maxFee: 680,
      },
      expectedFulfillmentInfo: {
        bitcoinBlockHeight: 975053,
      },
      txid: '5a656f99c5bfb112e0953632d3d2c5ef7b9f80db9ed384068102e114a154dafa',
    },
    acceptTx: null,
    btcTx: null,
    btcTxHex: null,
  },
  {
    id: 5090,
    outcome: 'rejected',
    kind: 'p2sh',
    direct: true,
    requestTxid: 'b7df28072eadc402aadfd4fb2361fc765ea5fa7b3cf0c0e7aa7525db401dac2e',
    sender: 'SP1XENKCWGQN6JR5NVM27TM5TG8TF20W0182DR66F',
    amountSats: 1099660,
    maxFeeSats: 340,
    burnHeight: 975042,
    version: '01',
    hashbytes: '7f78b702299ab364b64a5d78790c9ff86faaa4e2',
    scriptPubKey: 'a9147f78b702299ab364b64a5d78790c9ff86faaa4e287',
    address: null,
    payoutTxid: null,
    payoutVout: null,
    feeSats: null,
    acceptTxid: null,
    requestTx: {
      tx_id: '0xb7df28072eadc402aadfd4fb2361fc765ea5fa7b3cf0c0e7aa7525db401dac2e',
      tx_status: 'success',
      tx_type: 'contract_call',
      sender_address: 'SP1XENKCWGQN6JR5NVM27TM5TG8TF20W0182DR66F',
      sponsored: false,
      nonce: 21,
      fee_rate: '3500',
      block_height: 9440564,
      burn_block_height: 975042,
      tx_result: {
        hex: '0x0701000000000000000000000000000013e2',
        repr: '(ok u5090)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'initiate-withdrawal-request',
        function_signature:
          '(define-public (initiate-withdrawal-request (amount uint) (recipient (tuple (hashbytes (buff 32)) (version (buff 1)))) (max-fee uint)))',
        function_args: [
          {
            hex: '0x010000000000000000000000000010c78c',
            repr: 'u1099660',
            name: 'amount',
            type: 'uint',
          },
          {
            hex: '0x0c000000020968617368627974657302000000147f78b702299ab364b64a5d78790c9ff86faaa4e20776657273696f6e020000000101',
            repr: '(tuple (hashbytes 0x7f78b702299ab364b64a5d78790c9ff86faaa4e2) (version 0x01))',
            name: 'recipient',
            type: '(tuple (hashbytes (buff 32)) (version (buff 1)))',
          },
          {
            hex: '0x0100000000000000000000000000000154',
            repr: 'u340',
            name: 'max-fee',
            type: 'uint',
          },
        ],
      },
      post_condition_mode: 'deny',
      post_conditions: [
        {
          principal: {
            type_id: 'principal_standard',
            address: 'SP1XENKCWGQN6JR5NVM27TM5TG8TF20W0182DR66F',
          },
          condition_code: 'sent_equal_to',
          amount: '1100000',
          type: 'fungible',
          asset: {
            asset_name: 'sbtc-token',
            contract_address: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4',
            contract_name: 'sbtc-token',
          },
        },
      ],
      events: [
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          tx_id: '0xb7df28072eadc402aadfd4fb2361fc765ea5fa7b3cf0c0e7aa7525db401dac2e',
          asset: {
            asset_event_type: 'burn',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token',
            sender: 'SP1XENKCWGQN6JR5NVM27TM5TG8TF20W0182DR66F',
            recipient: '',
            amount: '1100000',
          },
        },
        {
          event_index: 1,
          event_type: 'fungible_token_asset',
          tx_id: '0xb7df28072eadc402aadfd4fb2361fc765ea5fa7b3cf0c0e7aa7525db401dac2e',
          asset: {
            asset_event_type: 'mint',
            asset_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token-locked',
            sender: '',
            recipient: 'SP1XENKCWGQN6JR5NVM27TM5TG8TF20W0182DR66F',
            amount: '1100000',
          },
        },
        {
          event_index: 2,
          event_type: 'smart_contract_log',
          tx_id: '0xb7df28072eadc402aadfd4fb2361fc765ea5fa7b3cf0c0e7aa7525db401dac2e',
          contract_log: {
            contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry',
            topic: 'print',
            value: {
              hex: '0x0c0000000706616d6f756e74010000000000000000000000000010c78c0c626c6f636b2d68656967687401000000000000000000000000000ee0c2076d61782d666565010000000000000000000000000000015409726563697069656e740c000000020968617368627974657302000000147f78b702299ab364b64a5d78790c9ff86faaa4e20776657273696f6e0200000001010a726571756573742d696401000000000000000000000000000013e20673656e64657205167aeacd9c85ea6960b5dd047d50ba8234f103800a05746f7069630d000000117769746864726177616c2d637265617465',
              repr: '(tuple (amount u1099660) (block-height u975042) (max-fee u340) (recipient (tuple (hashbytes 0x7f78b702299ab364b64a5d78790c9ff86faaa4e2) (version 0x01))) (request-id u5090) (sender \'SP1XENKCWGQN6JR5NVM27TM5TG8TF20W0182DR66F) (topic "withdrawal-create"))',
            },
          },
        },
      ],
      event_count: 3,
      vm_error: null,
    },
    requestRawTx:
      '0x000000000104007aeacd9c85ea6960b5dd047d50ba8234f103800a00000000000000150000000000000dac00008c7a73f7477a86341b979dc77c4b98e531235b127a222b6c78e4e489cdfd9d5a1f99ddb6930630e382014fcfdced420d5d850454c3be34e39d4891ce5f1f9f5a0302000000010102167aeacd9c85ea6960b5dd047d50ba8234f103800a14f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0a736274632d746f6b656e0a736274632d746f6b656e01000000000010c8e00214f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0f736274632d7769746864726177616c1b696e6974696174652d7769746864726177616c2d7265717565737400000003010000000000000000000000000010c78c0c000000020968617368627974657302000000147f78b702299ab364b64a5d78790c9ff86faaa4e20776657273696f6e0200000001010100000000000000000000000000000154',
    getWithdrawalRequest:
      '0x0a0c0000000606616d6f756e74010000000000000000000000000010c78c0c626c6f636b2d68656967687401000000000000000000000000000ee0c2076d61782d666565010000000000000000000000000000015409726563697069656e740c000000020968617368627974657302000000147f78b702299ab364b64a5d78790c9ff86faaa4e20776657273696f6e0200000001010673656e64657205167aeacd9c85ea6960b5dd047d50ba8234f103800a067374617475730a04',
    getSweepData: '0x09',
    emily: {
      requestId: 5090,
      stacksBlockHash: 'a1899919d6d623941cb5b024e12fe0cbb86392a3c80d24c429d135279e48eced',
      stacksBlockHeight: 9440564,
      recipient: 'a9147f78b702299ab364b64a5d78790c9ff86faaa4e287',
      sender: 'SP1XENKCWGQN6JR5NVM27TM5TG8TF20W0182DR66F',
      amount: 1099660,
      lastUpdateHeight: 9441946,
      lastUpdateBlockHash: '205a36500693eb29dc2fb7412e64aa4889dbae6b421a32a456f6ed921f25dcb8',
      status: 'failed',
      statusMessage: 'Rejected',
      parameters: {
        maxFee: 340,
      },
      expectedFulfillmentInfo: {
        bitcoinBlockHeight: 975049,
      },
      txid: 'b7df28072eadc402aadfd4fb2361fc765ea5fa7b3cf0c0e7aa7525db401dac2e',
    },
    acceptTx: null,
    btcTx: null,
    btcTxHex: null,
  },
];

export const REAL_FAILED_REQUESTS: readonly RealFailedRequest[] = [
  {
    txid: 'bd9b3ea22ba2b38232b0c9529e2241a08d2628cb79ebe823eb28dd4a6196238e',
    requestTx: {
      tx_id: '0xbd9b3ea22ba2b38232b0c9529e2241a08d2628cb79ebe823eb28dd4a6196238e',
      tx_status: 'abort_by_post_condition',
      tx_type: 'contract_call',
      sender_address: 'SP24D4S61ZN2XWG46RXEJBC7DVRF7M06K3D9RVZZZ',
      sponsored: false,
      nonce: 1,
      fee_rate: '3000',
      block_height: 9442263,
      burn_block_height: 975070,
      tx_result: {
        hex: '0x080100000000000000000000000000000001',
        repr: '(err u1)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'initiate-withdrawal-request',
        function_signature:
          '(define-public (initiate-withdrawal-request (amount uint) (recipient (tuple (hashbytes (buff 32)) (version (buff 1)))) (max-fee uint)))',
        function_args: [
          {
            hex: '0x010000000000000000000000000001fbd0',
            repr: 'u130000',
            name: 'amount',
            type: 'uint',
          },
          {
            hex: '0x0c0000000209686173686279746573020000001474e335bfa9b28a6fe079cf3d16243606364726720776657273696f6e020000000104',
            repr: '(tuple (hashbytes 0x74e335bfa9b28a6fe079cf3d1624360636472672) (version 0x04))',
            name: 'recipient',
            type: '(tuple (hashbytes (buff 32)) (version (buff 1)))',
          },
          {
            hex: '0x0100000000000000000000000000000388',
            repr: 'u904',
            name: 'max-fee',
            type: 'uint',
          },
        ],
      },
      post_condition_mode: 'deny',
      post_conditions: [
        {
          principal: {
            type_id: 'principal_standard',
            address: 'SP24D4S61ZN2XWG46RXEJBC7DVRF7M06K3D9RVZZZ',
          },
          condition_code: 'sent_equal_to',
          amount: '130904',
          type: 'fungible',
          asset: {
            asset_name: 'sbtc-token',
            contract_address: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4',
            contract_name: 'sbtc-token',
          },
        },
      ],
      events: [],
      event_count: 0,
      vm_error:
        'Post-condition check failure on fungible asset SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token owned by SP24D4S61ZN2XWG46RXEJBC7DVRF7M06K3D9RVZZZ: 130904 SentEq 0',
    },
    requestRawTx:
      '0x0000000001040088d264c1fd45de4086c75d25b0edde1e7a00d31b00000000000000010000000000000bb8000087b8d36f3a6ef064b8a86bba166aa887e4960e312bcab7c85b261c3905656eaa41bf086440d5bfaeb1e6c1606d26764022e15f2725fd5e69d854dd57c853635903020000000101021688d264c1fd45de4086c75d25b0edde1e7a00d31b14f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0a736274632d746f6b656e0a736274632d746f6b656e01000000000001ff580214f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0f736274632d7769746864726177616c1b696e6974696174652d7769746864726177616c2d7265717565737400000003010000000000000000000000000001fbd00c0000000209686173686279746573020000001474e335bfa9b28a6fe079cf3d16243606364726720776657273696f6e0200000001040100000000000000000000000000000388',
  },
  {
    txid: '0fd045de293aaf1c79a412e149cd00700237940d2a61ddf20d72d860120d481d',
    requestTx: {
      tx_id: '0x0fd045de293aaf1c79a412e149cd00700237940d2a61ddf20d72d860120d481d',
      tx_status: 'abort_by_response',
      tx_type: 'contract_call',
      sender_address: 'SPPPHE326QMGTJVHG1EA6096C34C4K87D6NR7FE8',
      sponsored: false,
      nonce: 0,
      fee_rate: '3000',
      block_height: 9447568,
      burn_block_height: 975159,
      tx_result: {
        hex: '0x080100000000000000000000000000000001',
        repr: '(err u1)',
      },
      contract_call: {
        contract_id: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
        function_name: 'initiate-withdrawal-request',
        function_signature:
          '(define-public (initiate-withdrawal-request (amount uint) (recipient (tuple (hashbytes (buff 32)) (version (buff 1)))) (max-fee uint)))',
        function_args: [
          {
            hex: '0x0100000000000000000000000001c9c380',
            repr: 'u30000000',
            name: 'amount',
            type: 'uint',
          },
          {
            hex: '0x0c00000002096861736862797465730200000014a617f73dc6637dda6a7b47fbc05d7dbc529fed260776657273696f6e020000000104',
            repr: '(tuple (hashbytes 0xa617f73dc6637dda6a7b47fbc05d7dbc529fed26) (version 0x04))',
            name: 'recipient',
            type: '(tuple (hashbytes (buff 32)) (version (buff 1)))',
          },
          {
            hex: '0x0100000000000000000000000000000640',
            repr: 'u1600',
            name: 'max-fee',
            type: 'uint',
          },
        ],
      },
      post_condition_mode: 'deny',
      post_conditions: [
        {
          principal: {
            type_id: 'principal_standard',
            address: 'SPZZ66CKFFGN9KFCTHWNK1709601D4Q5J7KJFDD1',
          },
          condition_code: 'sent_less_than_or_equal_to',
          amount: '30001600',
          type: 'fungible',
          asset: {
            asset_name: 'sbtc-token',
            contract_address: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4',
            contract_name: 'sbtc-token',
          },
        },
      ],
      events: [],
      event_count: 0,
      vm_error: null,
    },
    requestRawTx:
      '0x000000000104002d68b86235e90d4b71805ca3012660c8c24d076900000000000000000000000000000bb80000784bb9296cb26ae9376a6a922338317614ad059a4db71ff02aa5454699197684477859fa59749fd26903c0fe50c564e2516f67290a4e5f0a1fe07e26969ec7700302000000010102163ff319937be154cdecd4795984e049801692e59114f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0a736274632d746f6b656e0a736274632d746f6b656e050000000001c9c9c00214f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0f736274632d7769746864726177616c1b696e6974696174652d7769746864726177616c2d72657175657374000000030100000000000000000000000001c9c3800c00000002096861736862797465730200000014a617f73dc6637dda6a7b47fbc05d7dbc529fed260776657273696f6e0200000001040100000000000000000000000000000640',
  },
];
