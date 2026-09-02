// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract DTSDA {

    enum Status {
        ACTIVE,
        AMENDED,
        EXPIRED,
        REVOKED
    }

    struct DigitalTwin {
        string documentId;
        string contentHash;
        string perceptualHash;
        string ipfsCid;
        address issuer;
        uint256 timestamp;
        Status status;
    }

    mapping(bytes32 => DigitalTwin) public twins;
    mapping(address => bool) public authorizedIssuers;

    address public admin;

    event TwinRegistered(
        bytes32 indexed twinId,
        string documentId,
        address issuer
    );

    event TwinStatusChanged(
        bytes32 indexed twinId,
        Status newStatus
    );

    event IssuerAdded(address indexed issuer);
    event IssuerRemoved(address indexed issuer);

    modifier onlyIssuer() {
        require(
            authorizedIssuers[msg.sender],
            "Not an authorized issuer"
        );
        _;
    }

    modifier onlyAdmin() {
        require(
            msg.sender == admin,
            "Not admin"
        );
        _;
    }

    constructor() {
        admin = msg.sender;
        authorizedIssuers[msg.sender] = true;

        emit IssuerAdded(msg.sender);
    }

    function addIssuer(address issuer)
        external
        onlyAdmin
    {
        require(
            issuer != address(0),
            "Invalid issuer address"
        );

        authorizedIssuers[issuer] = true;

        emit IssuerAdded(issuer);
    }

    function removeIssuer(address issuer)
        external
        onlyAdmin
    {
        authorizedIssuers[issuer] = false;

        emit IssuerRemoved(issuer);
    }

    function registerTwin(
        bytes32 twinId,
        string calldata documentId,
        string calldata contentHash,
        string calldata perceptualHash,
        string calldata ipfsCid
    )
        external
        onlyIssuer
    {
        require(
            twinId != bytes32(0),
            "Invalid Twin ID"
        );

        require(
            twins[twinId].timestamp == 0,
            "Twin already exists"
        );

        twins[twinId] = DigitalTwin({
            documentId: documentId,
            contentHash: contentHash,
            perceptualHash: perceptualHash,
            ipfsCid: ipfsCid,
            issuer: msg.sender,
            timestamp: block.timestamp,
            status: Status.ACTIVE
        });

        emit TwinRegistered(
            twinId,
            documentId,
            msg.sender
        );
    }

    function revokeTwin(bytes32 twinId)
        external
        onlyIssuer
    {
        require(
            twins[twinId].timestamp != 0,
            "Twin does not exist"
        );

        require(
            twins[twinId].issuer == msg.sender,
            "Not original issuer"
        );

        twins[twinId].status = Status.REVOKED;

        emit TwinStatusChanged(
            twinId,
            Status.REVOKED
        );
    }

    function amendTwin(
        bytes32 twinId,
        string calldata newContentHash
    )
        external
        onlyIssuer
    {
        require(
            twins[twinId].timestamp != 0,
            "Twin does not exist"
        );

        require(
            twins[twinId].issuer == msg.sender,
            "Not original issuer"
        );

        twins[twinId].contentHash = newContentHash;
        twins[twinId].status = Status.AMENDED;

        emit TwinStatusChanged(
            twinId,
            Status.AMENDED
        );
    }

    function getTwin(bytes32 twinId)
        external
        view
        returns (
            string memory documentId,
            string memory contentHash,
            string memory perceptualHash,
            string memory ipfsCid,
            address issuer,
            uint256 timestamp,
            Status status
        )
    {
        DigitalTwin memory twin = twins[twinId];

        require(
            twin.timestamp != 0,
            "Twin does not exist"
        );

        return (
            twin.documentId,
            twin.contentHash,
            twin.perceptualHash,
            twin.ipfsCid,
            twin.issuer,
            twin.timestamp,
            twin.status
        );
    }
}