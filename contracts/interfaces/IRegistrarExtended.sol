// Copyright 2025, Smolrun LLC. All rights reserved.
// See the file LICENSE for licensing terms.

// SPDX-License-Identifier: MIT

pragma solidity 0.8.27;

import "./IRegistrar.sol";
import "../types/Types.sol";

interface IRegistrarExtended is IRegistrar {
    /**
     * @notice Registers a user with their public key
     * @param proof The zero-knowledge proof proving the validity of the registration
     */
    function register(RegisterProof calldata proof) external;
}