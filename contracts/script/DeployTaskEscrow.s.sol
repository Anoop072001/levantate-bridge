// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Script, console2} from "forge-std/Script.sol";
import {TaskEscrow} from "../src/TaskEscrow.sol";

contract DeployTaskEscrow is Script {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (TaskEscrow escrow) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address agent = vm.envOr("DEPLOYER_AGENT_ADDRESS", deployer);
        address relayer = vm.envOr("DEPLOYER_RELAYER_ADDRESS", deployer);

        vm.startBroadcast(deployerKey);
        escrow = new TaskEscrow(ARC_USDC, agent, relayer);
        vm.stopBroadcast();

        console2.log("TaskEscrow deployed at:", address(escrow));
        console2.log("USDC:", ARC_USDC);
        console2.log("Agent:", agent);
        console2.log("Relayer:", relayer);
    }
}
