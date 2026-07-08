// SPDX-License-Identifier: MIT
// Cible : OZ v3 — solc 0.7.6
// _select_oz_libs doit retourner nm-v3
pragma solidity 0.7.6;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract OzV3Test is Ownable {
    uint256 public value;

    function setValue(uint256 v) external onlyOwner {
        value = v;
    }
}
