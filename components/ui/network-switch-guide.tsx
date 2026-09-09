"use client";

export default function NetworkSwitchGuide() {
  return (
    <div className="bg-yellow-50 border-2 border-yellow-400 rounded-2xl p-6 mb-6">
      <h3 className="text-xl font-bold text-yellow-900 mb-3 flex items-center gap-2">
        <span className="text-xl">⭐</span>
        Important: Connect Your Freighter Wallet to Stellar Testnet
      </h3>

      <div className="space-y-4 text-sm">
        <p className="text-yellow-800">
          AuraFlow is currently deployed on <strong>Stellar Testnet</strong> for testing.
          You need to connect your Freighter wallet before creating transactions.
        </p>

        <div className="bg-white rounded-lg p-4">
          <h4 className="font-bold text-gray-900 mb-2">For Freighter Wallet:</h4>
          <ol className="list-decimal list-inside space-y-1 text-gray-700">
            <li>Install the Freighter browser extension from freighter.app</li>
            <li>Open Freighter and unlock your wallet</li>
            <li>Ensure you are on the Testnet network</li>
            <li>Click &quot;Connect Wallet&quot; in the AuraFlow app</li>
            <li>Approve the connection in Freighter</li>
          </ol>
        </div>

        <div className="bg-blue-50 rounded-lg p-4 flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-blue-100/50 flex items-center justify-center shrink-0 border border-blue-200">
            <span className="text-lg">⭐</span>
          </div>
          <div className="flex-1">
            <h4 className="font-bold text-blue-900 mb-1">Need Testnet XLM?</h4>
            <p className="text-blue-800 mb-2">
              Get free testnet XLM for gas fees:
            </p>
            <a
              href="https://faucet.stellar.org"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition-all text-xs"
            >
              Get Testnet XLM
            </a>
          </div>
        </div>

        <div className="bg-gray-100 rounded-lg p-4">
          <h4 className="font-bold text-gray-900 mb-2">Verify Network:</h4>
          <p className="text-gray-700">
            After connecting, you should see a green banner or indicator showing
            &quot;Connected to Stellar Testnet&quot;. If you still see a warning, try refreshing the page.
          </p>
        </div>
      </div>
    </div>
  );
}
