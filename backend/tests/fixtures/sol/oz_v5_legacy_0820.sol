// SPDX-License-Identifier: MIT
// Cible : OZ 5.0.2 — solc 0.8.20
// _select_oz_libs doit retourner nm-v5-legacy
// Cas réel : Usual Protocol utilise ce pragma + ces imports
pragma solidity 0.8.20;

import {OwnableUpgradeable} from "openzeppelin-contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ERC20Upgradeable} from "openzeppelin-contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {Initializable} from "openzeppelin-contracts-upgradeable/proxy/utils/Initializable.sol";

// OZ v5 API : __Ownable_init(msg.sender), constructeur vide requis
contract OzV5LegacyTest is Initializable, ERC20Upgradeable, OwnableUpgradeable {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) public initializer {
        __ERC20_init("TestToken", "TST");
        __Ownable_init(initialOwner);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
