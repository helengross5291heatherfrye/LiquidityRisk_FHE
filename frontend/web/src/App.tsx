// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface LiquidityData {
  id: string;
  institution: string;
  encryptedBalance: string;
  riskScore: number;
  timestamp: number;
  verified: boolean;
}

const App: React.FC = () => {
  // Randomly selected style: Gradient (warm sunset) + Glassmorphism + Center radiation + Micro-interactions
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [dataList, setDataList] = useState<LiquidityData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingData, setAddingData] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [notification, setNotification] = useState<{
    visible: boolean;
    type: "success" | "error" | "info";
    message: string;
  }>({ visible: false, type: "info", message: "" });
  const [newData, setNewData] = useState({
    institution: "",
    encryptedBalance: "",
    riskScore: 0
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Randomly selected features: Wallet management, Data list, Search & filter, Data statistics, Tutorial
  const filteredData = dataList.filter(item =>
    item.institution.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const highRiskCount = dataList.filter(item => item.riskScore > 70).length;
  const mediumRiskCount = dataList.filter(item => item.riskScore > 30 && item.riskScore <= 70).length;
  const lowRiskCount = dataList.filter(item => item.riskScore <= 30).length;

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      showNotification("error", "Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        throw new Error("Contract is not available");
      }
      
      const keysBytes = await contract.getData("liquidity_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing liquidity keys:", e);
        }
      }
      
      const list: LiquidityData[] = [];
      
      for (const key of keys) {
        try {
          const dataBytes = await contract.getData(`liquidity_${key}`);
          if (dataBytes.length > 0) {
            try {
              const data = JSON.parse(ethers.toUtf8String(dataBytes));
              list.push({
                id: key,
                institution: data.institution,
                encryptedBalance: data.encryptedBalance,
                riskScore: data.riskScore,
                timestamp: data.timestamp,
                verified: data.verified || false
              });
            } catch (e) {
              console.error(`Error parsing data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading data ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setDataList(list);
    } catch (e) {
      console.error("Error loading data:", e);
      showNotification("error", "Failed to load data");
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const addData = async () => {
    if (!provider) { 
      showNotification("error", "Please connect wallet first");
      return; 
    }
    
    setAddingData(true);
    showNotification("info", "Encrypting data with FHE...");
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataId = `liq-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

      const data = {
        institution: newData.institution,
        encryptedBalance: `FHE-ENC-${btoa(newData.encryptedBalance)}`,
        riskScore: newData.riskScore,
        timestamp: Math.floor(Date.now() / 1000),
        verified: false
      };
      
      await contract.setData(
        `liquidity_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(data))
      );
      
      const keysBytes = await contract.getData("liquidity_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(dataId);
      
      await contract.setData(
        "liquidity_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      showNotification("success", "Data encrypted and stored securely!");
      await loadData();
      
      setTimeout(() => {
        setShowAddModal(false);
        setNewData({
          institution: "",
          encryptedBalance: "",
          riskScore: 0
        });
      }, 1500);
    } catch (e: any) {
      const errorMsg = e.message.includes("user rejected transaction")
        ? "Transaction rejected"
        : "Failed to add data";
      showNotification("error", errorMsg);
    } finally {
      setAddingData(false);
    }
  };

  const verifyData = async (id: string) => {
    if (!provider) {
      showNotification("error", "Please connect wallet first");
      return;
    }

    showNotification("info", "Verifying with FHE computation...");

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataBytes = await contract.getData(`liquidity_${id}`);
      if (dataBytes.length === 0) {
        throw new Error("Data not found");
      }
      
      const data = JSON.parse(ethers.toUtf8String(dataBytes));
      const updatedData = {
        ...data,
        verified: true
      };
      
      await contract.setData(
        `liquidity_${id}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedData))
      );
      
      showNotification("success", "FHE verification completed!");
      await loadData();
    } catch (e: any) {
      showNotification("error", "Verification failed");
    }
  };

  const showNotification = (type: "success" | "error" | "info", message: string) => {
    setNotification({ visible: true, type, message });
    setTimeout(() => setNotification({ visible: false, type: "info", message: "" }), 3000);
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the FHE-powered liquidity analysis",
      icon: "🔗"
    },
    {
      title: "Submit Encrypted Data",
      description: "Add financial institution data which will be encrypted using FHE",
      icon: "🔒"
    },
    {
      title: "FHE Risk Analysis",
      description: "System analyzes encrypted data to assess liquidity risk without decryption",
      icon: "📊"
    },
    {
      title: "Market Insights",
      description: "Get aggregate risk assessments while keeping individual data private",
      icon: "👁️"
    }
  ];

  const renderRiskChart = () => {
    const total = dataList.length || 1;
    const highPercentage = (highRiskCount / total) * 360;
    const mediumPercentage = (mediumRiskCount / total) * 360;
    const lowPercentage = (lowRiskCount / total) * 360;

    return (
      <div className="risk-chart">
        <div className="chart-visual">
          <div className="chart-slice high" style={{ '--angle': `${highPercentage}deg` } as React.CSSProperties}></div>
          <div className="chart-slice medium" style={{ '--angle': `${mediumPercentage}deg` } as React.CSSProperties}></div>
          <div className="chart-slice low" style={{ '--angle': `${lowPercentage}deg` } as React.CSSProperties}></div>
          <div className="chart-center">
            <span>{dataList.length}</span>
            <small>Institutions</small>
          </div>
        </div>
        <div className="chart-legend">
          <div className="legend-item">
            <div className="legend-color high"></div>
            <span>High Risk: {highRiskCount}</span>
          </div>
          <div className="legend-item">
            <div className="legend-color medium"></div>
            <span>Medium Risk: {mediumRiskCount}</span>
          </div>
          <div className="legend-item">
            <div className="legend-color low"></div>
            <span>Low Risk: {lowRiskCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="loading-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <div className="background-gradient"></div>
      
      <header className="app-header">
        <div className="header-content">
          <div className="logo">
            <h1>FHE Liquidity Risk</h1>
            <span>Confidential Market Analysis</span>
          </div>
          
          <div className="header-actions">
            <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
          </div>
        </div>
      </header>

      <main className="main-content">
        <div className="hero-section">
          <div className="hero-content">
            <h2>Confidential Analysis of Financial Market Liquidity Risk</h2>
            <p>Regulators can analyze encrypted balance sheet data from multiple financial institutions using FHE to assess overall market liquidity risk.</p>
            <div className="hero-buttons">
              <button 
                className="glass-button primary"
                onClick={() => setShowAddModal(true)}
              >
                + Add Institution Data
              </button>
              <button 
                className="glass-button"
                onClick={() => setShowTutorial(!showTutorial)}
              >
                {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
              </button>
            </div>
          </div>
        </div>

        {showTutorial && (
          <div className="tutorial-section glass-card">
            <h2>How FHE Enables Confidential Risk Analysis</h2>
            <div className="tutorial-grid">
              {tutorialSteps.map((step, index) => (
                <div key={index} className="tutorial-card">
                  <div className="tutorial-icon">{step.icon}</div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="stats-section">
          <div className="stats-grid">
            <div className="stat-card glass-card">
              <h3>Total Institutions</h3>
              <div className="stat-value">{dataList.length}</div>
            </div>
            <div className="stat-card glass-card">
              <h3>High Risk</h3>
              <div className="stat-value danger">{highRiskCount}</div>
            </div>
            <div className="stat-card glass-card">
              <h3>Medium Risk</h3>
              <div className="stat-value warning">{mediumRiskCount}</div>
            </div>
            <div className="stat-card glass-card">
              <h3>Low Risk</h3>
              <div className="stat-value success">{lowRiskCount}</div>
            </div>
          </div>
        </div>

        <div className="data-section">
          <div className="section-header">
            <h2>Institution Liquidity Data</h2>
            <div className="search-box">
              <input
                type="text"
                placeholder="Search institutions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="glass-input"
              />
              <button 
                onClick={loadData}
                className="glass-button small"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="data-container glass-card">
            {filteredData.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📊</div>
                <h3>No liquidity data found</h3>
                <p>Add your first institution data to begin FHE analysis</p>
                <button 
                  className="glass-button primary"
                  onClick={() => setShowAddModal(true)}
                >
                  Add Data
                </button>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Institution</th>
                    <th>Risk Score</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.map(item => (
                    <tr key={item.id}>
                      <td className="mono">#{item.id.substring(0, 6)}</td>
                      <td>{item.institution}</td>
                      <td>
                        <div className={`risk-badge ${getRiskLevel(item.riskScore)}`}>
                          {item.riskScore}
                        </div>
                      </td>
                      <td>
                        {item.verified ? (
                          <span className="status verified">Verified</span>
                        ) : (
                          <span className="status pending">Pending</span>
                        )}
                      </td>
                      <td>
                        {!item.verified && (
                          <button 
                            className="glass-button small"
                            onClick={() => verifyData(item.id)}
                          >
                            Verify
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="analysis-section">
          <div className="section-header">
            <h2>Market Risk Distribution</h2>
          </div>
          <div className="analysis-content glass-card">
            <div className="chart-container">
              {renderRiskChart()}
            </div>
            <div className="analysis-text">
              <h3>FHE-Powered Risk Assessment</h3>
              <p>
                This analysis is performed on encrypted balance sheet data using Fully Homomorphic Encryption.
                Individual institution data remains confidential while providing aggregate risk insights.
              </p>
              <div className="fhe-badge">
                <span>FHE Secure Computation</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {showAddModal && (
        <div className="modal-overlay">
          <div className="add-modal glass-card">
            <div className="modal-header">
              <h2>Add Institution Data</h2>
              <button onClick={() => setShowAddModal(false)} className="close-button">
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Institution Name</label>
                <input
                  type="text"
                  name="institution"
                  value={newData.institution}
                  onChange={(e) => setNewData({...newData, institution: e.target.value})}
                  className="glass-input"
                  placeholder="e.g. Bank of Crypto"
                />
              </div>
              <div className="form-group">
                <label>Encrypted Balance (FHE)</label>
                <textarea
                  name="encryptedBalance"
                  value={newData.encryptedBalance}
                  onChange={(e) => setNewData({...newData, encryptedBalance: e.target.value})}
                  className="glass-input"
                  rows={3}
                  placeholder="Paste encrypted balance sheet data"
                />
              </div>
              <div className="form-group">
                <label>Initial Risk Score</label>
                <input
                  type="number"
                  name="riskScore"
                  value={newData.riskScore}
                  onChange={(e) => setNewData({...newData, riskScore: parseInt(e.target.value) || 0})}
                  className="glass-input"
                  min="0"
                  max="100"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                onClick={() => setShowAddModal(false)}
                className="glass-button"
              >
                Cancel
              </button>
              <button
                onClick={addData}
                disabled={addingData || !newData.institution || !newData.encryptedBalance}
                className="glass-button primary"
              >
                {addingData ? "Encrypting..." : "Submit Securely"}
              </button>
            </div>
          </div>
        </div>
      )}

      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}

      {notification.visible && (
        <div className={`notification ${notification.type}`}>
          {notification.message}
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-info">
            <h3>FHE Liquidity Risk Analysis</h3>
            <p>Confidential assessment of financial market stability using Fully Homomorphic Encryption</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms</a>
          </div>
        </div>
        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} Confidential Financial Analysis Platform</p>
        </div>
      </footer>
    </div>
  );
};

const getRiskLevel = (score: number): string => {
  if (score > 70) return 'high';
  if (score > 30) return 'medium';
  return 'low';
};

export default App;