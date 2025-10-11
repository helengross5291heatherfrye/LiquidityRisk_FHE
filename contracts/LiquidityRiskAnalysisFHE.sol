// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract LiquidityRiskAnalysisFHE is SepoliaConfig {
    struct EncryptedBalanceSheet {
        uint256 id;
        address institution;
        euint32 encryptedLiquidAssets;       // Encrypted liquid assets
        euint32 encryptedTotalAssets;        // Encrypted total assets
        euint32 encryptedCurrentLiabilities; // Encrypted current liabilities
        euint32 encryptedTotalLiabilities;   // Encrypted total liabilities
        euint32 encryptedNetCapital;         // Encrypted net capital
        uint256 timestamp;
    }
    
    struct DecryptedMetrics {
        uint32 liquidAssets;
        uint32 totalAssets;
        uint32 currentLiabilities;
        uint32 totalLiabilities;
        uint32 netCapital;
        bool isRevealed;
    }

    struct AggregatedRiskMetrics {
        euint32 totalLiquidAssets;
        euint32 totalCurrentLiabilities;
        euint32 liquidityRatio; // Encrypted liquidity ratio
        euint32 netCapitalRatio; // Encrypted net capital ratio
        bool isInitialized;
    }

    uint256 public reportCount;
    mapping(uint256 => EncryptedBalanceSheet) public encryptedReports;
    mapping(uint256 => DecryptedMetrics) public decryptedMetrics;
    mapping(address => uint256[]) private institutionReports;
    
    AggregatedRiskMetrics public marketRiskMetrics;
    
    mapping(uint256 => uint256) private requestToReportId;
    
    event ReportSubmitted(uint256 indexed id, address indexed institution);
    event DecryptionRequested(uint256 indexed id);
    event MetricsDecrypted(uint256 indexed id);
    event AggregationCompleted();
    
    modifier onlyRegulator() {
        // In production, add regulator access control
        _;
    }
    
    constructor() {
        marketRiskMetrics = AggregatedRiskMetrics({
            totalLiquidAssets: FHE.asEuint32(0),
            totalCurrentLiabilities: FHE.asEuint32(0),
            liquidityRatio: FHE.asEuint32(0),
            netCapitalRatio: FHE.asEuint32(0),
            isInitialized: true
        });
    }
    
    /// @notice Submit encrypted balance sheet data
    function submitEncryptedBalanceSheet(
        euint32 encryptedLiquidAssets,
        euint32 encryptedTotalAssets,
        euint32 encryptedCurrentLiabilities,
        euint32 encryptedTotalLiabilities,
        euint32 encryptedNetCapital
    ) public {
        reportCount += 1;
        uint256 newId = reportCount;
        
        encryptedReports[newId] = EncryptedBalanceSheet({
            id: newId,
            institution: msg.sender,
            encryptedLiquidAssets: encryptedLiquidAssets,
            encryptedTotalAssets: encryptedTotalAssets,
            encryptedCurrentLiabilities: encryptedCurrentLiabilities,
            encryptedTotalLiabilities: encryptedTotalLiabilities,
            encryptedNetCapital: encryptedNetCapital,
            timestamp: block.timestamp
        });
        
        decryptedMetrics[newId] = DecryptedMetrics({
            liquidAssets: 0,
            totalAssets: 0,
            currentLiabilities: 0,
            totalLiabilities: 0,
            netCapital: 0,
            isRevealed: false
        });
        
        institutionReports[msg.sender].push(newId);
        emit ReportSubmitted(newId, msg.sender);
    }
    
    /// @notice Aggregate encrypted market risk metrics
    function aggregateMarketRisk() public onlyRegulator {
        require(marketRiskMetrics.isInitialized, "Metrics not initialized");
        
        for (uint256 i = 1; i <= reportCount; i++) {
            EncryptedBalanceSheet storage report = encryptedReports[i];
            
            marketRiskMetrics.totalLiquidAssets = FHE.add(
                marketRiskMetrics.totalLiquidAssets,
                report.encryptedLiquidAssets
            );
            
            marketRiskMetrics.totalCurrentLiabilities = FHE.add(
                marketRiskMetrics.totalCurrentLiabilities,
                report.encryptedCurrentLiabilities
            );
        }
        
        // Calculate liquidity ratio: totalLiquidAssets / totalCurrentLiabilities
        // Note: Actual division in FHE requires additional handling
        marketRiskMetrics.liquidityRatio = FHE.div(
            marketRiskMetrics.totalLiquidAssets,
            marketRiskMetrics.totalCurrentLiabilities
        );
        
        emit AggregationCompleted();
    }
    
    /// @notice Request decryption of institution metrics
    function requestMetricsDecryption(uint256 reportId) public {
        EncryptedBalanceSheet storage report = encryptedReports[reportId];
        require(report.institution == msg.sender, "Not institution owner");
        require(!decryptedMetrics[reportId].isRevealed, "Metrics already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](5);
        ciphertexts[0] = FHE.toBytes32(report.encryptedLiquidAssets);
        ciphertexts[1] = FHE.toBytes32(report.encryptedTotalAssets);
        ciphertexts[2] = FHE.toBytes32(report.encryptedCurrentLiabilities);
        ciphertexts[3] = FHE.toBytes32(report.encryptedTotalLiabilities);
        ciphertexts[4] = FHE.toBytes32(report.encryptedNetCapital);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptInstitutionMetrics.selector);
        requestToReportId[reqId] = reportId;
        
        emit DecryptionRequested(reportId);
    }
    
    /// @notice Process decrypted institution metrics
    function decryptInstitutionMetrics(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 reportId = requestToReportId[requestId];
        require(reportId != 0, "Invalid request");
        
        EncryptedBalanceSheet storage eReport = encryptedReports[reportId];
        DecryptedMetrics storage dMetrics = decryptedMetrics[reportId];
        require(!dMetrics.isRevealed, "Metrics already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint32 liquidAssets, 
         uint32 totalAssets, 
         uint32 currentLiabilities, 
         uint32 totalLiabilities, 
         uint32 netCapital) = abi.decode(cleartexts, (uint32, uint32, uint32, uint32, uint32));
        
        dMetrics.liquidAssets = liquidAssets;
        dMetrics.totalAssets = totalAssets;
        dMetrics.currentLiabilities = currentLiabilities;
        dMetrics.totalLiabilities = totalLiabilities;
        dMetrics.netCapital = netCapital;
        dMetrics.isRevealed = true;
        
        emit MetricsDecrypted(reportId);
    }
    
    /// @notice Request decryption of market liquidity ratio
    function requestLiquidityRatioDecryption() public onlyRegulator {
        require(marketRiskMetrics.isInitialized, "Metrics not initialized");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(marketRiskMetrics.liquidityRatio);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptMarketRatio.selector);
        requestToReportId[reqId] = 0; // Using 0 to indicate market-level request
    }
    
    /// @notice Process decrypted market ratio
    function decryptMarketRatio(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        require(requestToReportId[requestId] == 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 ratio = abi.decode(cleartexts, (uint32));
        // Handle decrypted market liquidity ratio
    }
    
    /// @notice Calculate institution-specific risk metrics
    function calculateInstitutionRisk(uint256 reportId) public view returns (
        euint32 liquidityRatio,
        euint32 solvencyRatio
    ) {
        EncryptedBalanceSheet storage report = encryptedReports[reportId];
        
        // Liquidity ratio: liquidAssets / currentLiabilities
        liquidityRatio = FHE.div(
            report.encryptedLiquidAssets,
            report.encryptedCurrentLiabilities
        );
        
        // Solvency ratio: netCapital / totalAssets
        solvencyRatio = FHE.div(
            report.encryptedNetCapital,
            report.encryptedTotalAssets
        );
        
        return (liquidityRatio, solvencyRatio);
    }
    
    /// @notice Retrieve institution reports
    function getInstitutionReports(address institution) public view returns (uint256[] memory) {
        return institutionReports[institution];
    }
    
    /// @notice Get decrypted institution metrics
    function getDecryptedMetrics(uint256 reportId) public view returns (
        uint32 liquidAssets,
        uint32 totalAssets,
        uint32 currentLiabilities,
        uint32 totalLiabilities,
        uint32 netCapital,
        bool isRevealed
    ) {
        DecryptedMetrics storage m = decryptedMetrics[reportId];
        return (
            m.liquidAssets,
            m.totalAssets,
            m.currentLiabilities,
            m.totalLiabilities,
            m.netCapital,
            m.isRevealed
        );
    }
}