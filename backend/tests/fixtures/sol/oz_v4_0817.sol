// SPDX-License-Identifier: MIT
// Cible : OZ v4 — solc 0.8.17
// _select_oz_libs doit retourner nm-v4
pragma solidity 0.8.17;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// OZ v4 API : Ownable() sans argument, ERC20(name, symbol)
contract OzV4Test is ERC20, Ownable {
    constructor() ERC20("TestToken", "TST") {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
