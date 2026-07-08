// SPDX-License-Identifier: MIT
// Cible : OZ v5 latest — solc 0.8.28
// _select_oz_libs doit retourner nm-v5-modern
// Utilise transient storage (EIP-1153), disponible depuis solc 0.8.24
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

// ReentrancyGuardTransient est apparu dans OZ v5.1 — requiert ^0.8.24
contract OzV5ModernTest is ERC20, Ownable, ReentrancyGuardTransient {
    constructor() ERC20("TestToken", "TST") Ownable(msg.sender) {}

    function mint(address to, uint256 amount) external onlyOwner nonReentrant {
        _mint(to, amount);
    }
}
